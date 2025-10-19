chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab.url && (tab.url.includes('qwen.ai') || tab.url.includes('qwenlm.ai'))) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['settings-panel.js']
      });
    } else {
      chrome.tabs.create({ url: 'https://chat.qwen.ai' });
    }
  } catch (error) {
    console.error('[Action] Error injecting settings panel:', error);
  }
});

const DEFAULT_WEBSOCKET_URL = "ws://localhost:8080";
const RECONNECT_ALARM_NAME = "websocket-reconnect-alarm";
const RECONNECT_DELAY_MIN = 0.1;
const STORAGE_KEY = 'qwenProxyState';
const HEARTBEAT_INTERVAL_MIN = 1;
const HEARTBEAT_ALARM_NAME = "websocket-heartbeat-alarm";

let ws = null;

async function getState() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const state = result[STORAGE_KEY] || {};
  return {
    qwenTabs: new Map(state.qwenTabs || []),
    taskQueue: state.taskQueue || [],
    currentTabIndex: state.currentTabIndex || 0,
  };
}

async function saveState(state) {
  await chrome.storage.session.set({
    [STORAGE_KEY]: {
      qwenTabs: Array.from(state.qwenTabs.entries()),
      taskQueue: state.taskQueue,
      currentTabIndex: state.currentTabIndex,
    },
  });
}

function addQwenTab(state, tabId, url) {
  if (!state.qwenTabs.has(tabId)) {
    state.qwenTabs.set(tabId, {
      id: tabId,
      url: url,
      status: "idle",
      lastUsed: Date.now(),
      currentCommandId: null,
    });
  }
}

function removeQwenTab(state, tabId) {
  if (state.qwenTabs.has(tabId)) {
    state.qwenTabs.delete(tabId);
  }
}

function setTabStatus(state, tabId, status, commandId = null) {
  if (state.qwenTabs.has(tabId)) {
    const tabInfo = state.qwenTabs.get(tabId);
    tabInfo.status = status;
    if (status === "idle") {
      tabInfo.lastUsed = Date.now();
      tabInfo.currentCommandId = null;
    } else if (status === "busy" && commandId) {
      tabInfo.currentCommandId = commandId;
    }
  }
}

function getIdleTab(state) {
  const idleTabs = Array.from(state.qwenTabs.values()).filter(
    (tab) => tab.status === "idle"
  );
  if (idleTabs.length === 0) return null;

  const selectedTab = idleTabs[state.currentTabIndex % idleTabs.length];
  state.currentTabIndex = (state.currentTabIndex + 1) % idleTabs.length;
  return selectedTab;
}

async function dispatchTask(state, taskData) {
  const idleTab = getIdleTab(state);

  if (idleTab) {
    const taskObj = JSON.parse(taskData);
    setTabStatus(state, idleTab.id, "busy", taskObj.commandId);
    await saveState(state);
    sendTaskToTab(idleTab.id, taskData);
    return true;
  } else {
    state.taskQueue.push(taskData);
    await saveState(state);
    return false;
  }
}

async function sendTaskToTab(tabId, taskData) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "COMMAND_FROM_SERVER",
      data: taskData,
    });
  } catch (error) {
    console.error(`[TaskManager] Failed to send task to tab ${tabId}:`, error);
    const state = await getState();
    setTabStatus(state, tabId, "idle");
    await saveState(state);
    processTaskQueue();
  }
}

async function processTaskQueue() {
  const state = await getState();
  while (state.taskQueue.length > 0) {
    const task = state.taskQueue.shift();
    if (!(await dispatchTask(state, task))) {
      state.taskQueue.unshift(task);
      await saveState(state);
      break;
    }
  }
}

async function onTaskCompleted(tabId) {
  const state = await getState();
  setTabStatus(state, tabId, "idle");
  await saveState(state);
  processTaskQueue();
}

async function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  
  const { wsUrl } = await chrome.storage.sync.get("wsUrl");
  const websocketUrl = wsUrl || DEFAULT_WEBSOCKET_URL;

  try {
    ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
      chrome.alarms.clear(RECONNECT_ALARM_NAME);
      
      chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
        delayInMinutes: HEARTBEAT_INTERVAL_MIN,
        periodInMinutes: HEARTBEAT_INTERVAL_MIN,
      });
      
      sendWebSocketMessage({ type: 'scriptReady', url: 'chrome-extension', platform: 'qwen' });
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          return;
        }
      } catch (e) { }

      const state = await getState();
      try {
        const message = JSON.parse(event.data);
        if (message.task_type === "image" && message.prompt) {
          if (message.targetTabId && state.qwenTabs.has(message.targetTabId)) {
            setTabStatus(state, message.targetTabId, "busy", message.commandId);
            await saveState(state);
            sendTaskToTab(message.targetTabId, event.data);
          } else {
            await dispatchTask(state, event.data);
          }
        }
      } catch (e) {
        console.error("Failed to process server message:", e);
      }
    };

    ws.onerror = (error) => {
      console.warn("[WebSocket] Error:", error);
    };

    ws.onclose = (event) => {
      ws = null;
      chrome.alarms.clear(HEARTBEAT_ALARM_NAME);
      scheduleReconnect();
    };
  } catch (e) {
    console.error("[WebSocket] Failed to create WebSocket instance:", e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  chrome.alarms.create(RECONNECT_ALARM_NAME, {
    delayInMinutes: RECONNECT_DELAY_MIN,
  });
}

function sendWebSocketMessage(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(typeof data === "object" ? JSON.stringify(data) : String(data));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const state = await getState();

    switch (message.type) {
      case "COLLECTED_IMAGE_URLS": {
        const tabId = sender.tab.id;
        if (!tabId) return;

        const commandId = state.qwenTabs.get(tabId)?.currentCommandId || null;
        sendWebSocketMessage({
          type: "collectedImageUrls",
          commandId: commandId,
          urls: message.urls,
        });
        await onTaskCompleted(tabId);
        sendResponse({ success: true });
        break;
      }
      case "TAB_STATUS_UPDATE": {
        const tabId = sender.tab.id;
        if (!tabId) return;
        if (message.status) {
          setTabStatus(state, tabId, message.status, state.qwenTabs.get(tabId)?.currentCommandId);
          await saveState(state);
        }
        sendResponse({ success: true });
        break;
      }
      case "GET_TAB_STATUS": {
        const tabStatus = Array.from(state.qwenTabs.values()).map((tab) => ({
          id: tab.id, status: tab.status, lastUsed: tab.lastUsed, url: tab.url
        }));
        sendResponse({
          tabs: tabStatus,
          queueLength: state.taskQueue.length,
          wsConnected: ws && ws.readyState === WebSocket.OPEN,
        });
        break;
      }
      case "FORCE_TASK_DISPATCH": {
        const { tabId, task } = message;
        if (tabId && task && state.qwenTabs.has(tabId)) {
            try {
                const taskObj = JSON.parse(task);
                setTabStatus(state, tabId, "busy", taskObj.commandId);
                await saveState(state);
                sendTaskToTab(tabId, task);
                sendResponse({ success: true });
            } catch(e) {
                sendResponse({ success: false, error: "Invalid task JSON" });
            }
        } else {
            sendResponse({ success: false, error: "Invalid tab or task" });
        }
        break;
      }
      case "ERROR_FROM_CONTENT": {
         const tabId = sender.tab.id;
         if (!tabId) return;

         console.error(`[Background] Error from tab ${tabId}:`, message.error);
         const commandId = state.qwenTabs.get(tabId)?.currentCommandId;
         sendWebSocketMessage({
            type: "error",
            commandId: commandId,
            errorDetails: message.error,
         });
         await onTaskCompleted(tabId);
         sendResponse({ success: true });
         break;
      }
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && (tab.url.includes('qwen.ai') || tab.url.includes('qwenlm.ai'))) {
    const state = await getState();
    const isFirstTab = state.qwenTabs.size === 0;
    addQwenTab(state, tabId, tab.url);
    await saveState(state);

    if (isFirstTab) {
      connectWebSocket();
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.qwenTabs.has(tabId)) {
    removeQwenTab(state, tabId);
    if (state.qwenTabs.size === 0) {
      if (ws) ws.close();
      chrome.alarms.clear(RECONNECT_ALARM_NAME);
      chrome.alarms.clear(HEARTBEAT_ALARM_NAME);
      state.taskQueue = [];
      state.currentTabIndex = 0;
    }
    await saveState(state);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  saveState({ qwenTabs: new Map(), taskQueue: [], currentTabIndex: 0 });
});

chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["https://chat.qwen.ai/*", "https://*.qwen.ai/*"] });
  if (tabs.length > 0) {
    const state = await getState();
    tabs.forEach(tab => addQwenTab(state, tab.id, tab.url));
    await saveState(state);
    connectWebSocket();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM_NAME) {
    connectWebSocket();
  } 
  else if (alarm.name === HEARTBEAT_ALARM_NAME) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendWebSocketMessage({ type: 'ping' });
    }
  }
});