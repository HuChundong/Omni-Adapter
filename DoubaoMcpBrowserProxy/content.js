// 监听 history API
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function () {
  originalPushState.apply(this, arguments);
  safeSendMessage({ type: "NAVIGATION" });
};

history.replaceState = function () {
  originalReplaceState.apply(this, arguments);
  safeSendMessage({ type: "NAVIGATION" });
};

// 监听 location.href 修改
let lastHref = location.href;
new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    safeSendMessage({ type: "NAVIGATION" });
  }
}).observe(document, { subtree: true, childList: true });

// 监听 hashchange 事件
window.addEventListener("hashchange", () => {
  safeSendMessage({ type: "NAVIGATION" });
});

// --- Configuration ---
const CHAT_INPUT_SELECTOR = '[data-testid="chat_input_input"]';
const UPLOAD_FILE_INPUT_SELECTOR = '[data-testid="upload-file-input"]';
const INPUT_SEND_DELAY_MS = 200;

// --- Extension Context Management ---
let extensionContextValid = true;

// 检查扩展上下文是否有效
function isExtensionContextValid() {
  try {
    // 尝试访问chrome.runtime，如果扩展上下文失效会抛出异常
    return chrome.runtime && chrome.runtime.id;
  } catch (error) {
    extensionContextValid = false;
    return false;
  }
}

// 安全的发送消息函数
function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) {
    console.warn("[ExtensionContext] Extension context invalid, skipping message:", message.type);
    return;
  }
  
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  } catch (error) {
    console.error("[ExtensionContext] Failed to send message:", error);
    extensionContextValid = false;
  }
}
const IMAGE_COLLECTION_SETTLE_DELAY_MS = 1500;

// --- Global State ---
const processedUrls = new Set();
const foundImageUrls = [];
const downloadImageUrls = []; // 用于下载的独立图片列表
let imageCollectionTimer = null;
let currentCommandId = null; // 当前命令ID
let shouldAutoReload = true; // 默认开启自动刷新
let shouldClearCookies = false; // 默认不清除cookie
let downloadButton = null; // 下载按钮引用

// 监听来自background.js的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "IMAGE_URLS") {
    console.log(
      "[Message Handler] Received image URLs from background:",
      message.urls
    );

    // 将新的URL添加到foundImageUrls中
    message.urls.forEach((url) => {
      if (!processedUrls.has(url)) {
        processedUrls.add(url);
        foundImageUrls.push(url);
        downloadImageUrls.push(url); // 同时添加到下载列表
        console.log(
          `[Message Handler] Added URL to collection. Total collected: ${foundImageUrls.length}`
        );
      }
    });

    // 更新下载按钮状态
    updateDownloadButton();

    // 直接发送并清理
    performSendAndCleanup();
  } else if (message.type === "COMMAND_FROM_SERVER" && message.data) {
    console.log(
      `[Message Handler] Received command from background: "${message.data}"`
    );
    try {
      const command = JSON.parse(message.data);
      if (command.task_type === "image" && command.prompt) {
        handleGenerateImageCommand(command);
      } else {
        console.warn("[Message Handler] Received unsupported command format:", command);
        sendErrorToBackground("Unsupported command format", command);
        notifyTaskCompleted();
      }
    } catch (e) {
      console.error("[Message Handler] Failed to parse command JSON:", e, message.data);
      sendErrorToBackground("Failed to parse command JSON.", { error: e.message, data: message.data });
      notifyTaskCompleted();
    }
  }
});

// 通知background script任务完成
function notifyTaskCompleted() {
  safeSendMessage({ type: "TASK_COMPLETED" }, (response) => {
    try {
      if (chrome.runtime.lastError) {
        console.error(
          "[TaskManager] Error notifying task completion:",
          chrome.runtime.lastError
        );
      } else {
        console.log(
          "[TaskManager] Task completion notification sent successfully"
        );
      }
    } catch (callbackError) {
      console.error("[TaskManager] Callback error:", callbackError);
    }
  });
}

// 向background script发送错误信息
function sendErrorToBackground(message, details = {}) {
  safeSendMessage({
    type: "ERROR_FROM_CONTENT",
    error: { message, details }
  });
}

// 更新tab状态
function updateTabStatus(status) {
  safeSendMessage(
    { type: "TAB_STATUS_UPDATE", status: status },
    (response) => {
      try {
        if (chrome.runtime.lastError) {
          console.error(
            "[TaskManager] Error updating tab status:",
            chrome.runtime.lastError
          );
        } else {
          console.log(`[TaskManager] Tab status updated to ${status}`);
        }
      } catch (callbackError) {
        console.error("[TaskManager] Callback error:", callbackError);
      }
    }
  );
}

// 从 Chrome 存储中读取设置
chrome.storage.sync.get(["autoReload", "clearCookies"], function (result) {
  if (result.autoReload !== undefined) {
    shouldAutoReload = result.autoReload;
    console.log(
      `[Settings] Auto reload is ${shouldAutoReload ? "enabled" : "disabled"}`
    );
  }
  if (result.clearCookies !== undefined) {
    shouldClearCookies = result.clearCookies;
    console.log(
      `[Settings] Clear cookies is ${
        shouldClearCookies ? "enabled" : "disabled"
      }`
    );
  }
});

// 监听设置变化
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === "sync") {
    if (changes.autoReload) {
      shouldAutoReload = changes.autoReload.newValue;
      console.log(
        `[Settings] Auto reload setting changed to ${shouldAutoReload}`
      );
    }
    if (changes.clearCookies) {
      shouldClearCookies = changes.clearCookies.newValue;
      console.log(
        `[Settings] Clear cookies setting changed to ${shouldClearCookies}`
      );
    }
  }
});

// --- Image Collection & Cleanup ---
function performSendAndCleanup() {
  console.log(
    "[Cleanup] Image discovery settled. Initiating send and cleanup..."
  );
  imageCollectionTimer = null;

  // 发送图片URL到background
  if (foundImageUrls.length > 0) {
    console.log(
      `[Cleanup] Sending ${foundImageUrls.length} collected image URLs.`
    );
    safeSendMessage({
      type: "COLLECTED_IMAGE_URLS",
      commandId: currentCommandId, // 添加commandId支持
      urls: foundImageUrls,
    });
  } else {
    console.log(
      "[Cleanup] No image URLs were collected during this session. Sending empty list."
    );
    safeSendMessage({ 
      type: "COLLECTED_IMAGE_URLS", 
      commandId: currentCommandId, // 添加commandId支持
      urls: [] 
    });
  }

  setTimeout(() => {
    console.log("[Cleanup] Initiating storage cleanup after send delay...");

    try {
      localStorage.clear();
      console.log("[Cleanup] localStorage cleared.");
    } catch (e) {
      console.error("[Cleanup] Error clearing localStorage:", e);
    }

    try {
      sessionStorage.clear();
      console.log("[Cleanup] sessionStorage cleared.");
    } catch (e) {
      console.error("[Cleanup] Error clearing sessionStorage:", e);
    }

    foundImageUrls.length = 0;
    processedUrls.clear();
    console.log("[Cleanup] Internal image lists cleared.");

    if (shouldAutoReload) {
      console.log("[Cleanup] Auto reload is enabled. Reloading page...");
      setTimeout(() => {
        window.location.href = "https://www.doubao.com/chat/";
      }, 1500);
    } else {
      console.log("[Cleanup] Auto reload is disabled. Skipping page reload.");
    }
  }, 100);
}

// --- Input Handling ---
// 专门使用 data-testid="chat_input_input" 的元素查找函数
function findChatInputWithRetry() {
  const element = document.querySelector(CHAT_INPUT_SELECTOR);
  
  if (element && element.tagName === "TEXTAREA") {
    return element;
  }
  
  return null;
}

function findChatInput() {
  const element = document.querySelector(CHAT_INPUT_SELECTOR);
  
  if (element && element.tagName === "TEXTAREA") {
    return element;
  }
  
  return null;
}

// 专门使用 data-testid="upload-file-input" 的元素查找函数
function findUploadFileInput() {
  return document.querySelector(UPLOAD_FILE_INPUT_SELECTOR);
}

// 核心函数：处理从后台接收到的文生图命令
async function handleGenerateImageCommand(command) {
  updateTabStatus("busy");
  
  // 保存当前命令ID
  currentCommandId = command.commandId;

  const inputElement = findChatInputWithRetry();
  if (!inputElement) {
    console.error("[Input] Chat input element not found.");
    sendErrorToBackground("Chat input element not found.", { commandId: currentCommandId });
    updateTabStatus("idle");
    notifyTaskCompleted();
    return;
  }

  console.log(`[Input] Processing command: ${command.prompt}`);

  try {
    inputElement.focus();
    
    // 如果有参考图片，先上传并等待完成
    if (command.file && command.imageUrl) {
      await upload_files(command.imageUrl);
      await waitForUploadComplete();
      // 上传完成后额外等待1秒
      await new Promise(r => setTimeout(r, 1000));
    }

    // 使用原有的文本输入和发送逻辑，并添加比例信息
    const ratioText = command.ratio ? `，图片比例为${command.ratio}` : '';
    const newValue = command.prompt + ratioText;

    try {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputElement, newValue);
      } else {
        inputElement.value = newValue;
      }
    } catch (e) {
      console.error("Error setting input value:", e);
      if (inputElement.value !== newValue) {
        inputElement.value = newValue;
      }
    }

    const inputEvent = new Event("input", {
      bubbles: true,
      cancelable: false,
    });

    inputElement.dispatchEvent(inputEvent);

    setTimeout(async () => {
      await sendMessageWithRetry(inputElement, newValue);
    }, INPUT_SEND_DELAY_MS);
  } catch (e) {
    console.error("[Input] Error during command execution:", e);
    sendErrorToBackground("Command execution failed.", { error: e.message, command: command, commandId: currentCommandId });
    updateTabStatus("idle");
    notifyTaskCompleted();
  }
}

// 发送消息并重试
async function sendMessageWithRetry(inputElement, expectedValue) {
  const maxRetries = 2;
  let retryCount = 0;
  
  while (retryCount <= maxRetries) {
    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
    });

    inputElement.dispatchEvent(enterEvent);
    await new Promise(r => setTimeout(r, 1000));
    
    const currentValue = inputElement.value.trim();
    if (currentValue === "" || currentValue !== expectedValue) {
      return true;
    }
    
    retryCount++;
    if (retryCount <= maxRetries) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  return false;
}

// 等待图片上传完成
async function waitForUploadComplete() {
  const maxWaitTime = 30000;
  const checkInterval = 500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    const progressElement = document.querySelector('.semi-progress-circle');
    
    if (!progressElement) {
      await new Promise(r => setTimeout(r, 1000));
      return true;
    }
    
    await new Promise(r => setTimeout(r, checkInterval));
  }
  
  return false;
}

async function upload_files(url) {
  if (!url || url.length == 0) {
    return;
  }
  
  let inputElement = findUploadFileInput();
  
  if (!inputElement) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    inputElement = findUploadFileInput();
  }
  
  if (!inputElement) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    inputElement = findUploadFileInput();
  }
  
  if (!inputElement) {
    return;
  }
  // url = 'https://p3-flow-imagex-sign.byteimg.com/tos-cn-i-a9rns2rl98/rc/pc/creation_agent/f39b78a9f10f44cab6aa2810ad31323a~tplv-a9rns2rl98-image-dark-watermark.png?rk3s=8e244e95&rrcfp=5057214b&x-expires=2068132585&x-signature=hc%2Fhayt1rB8W2InwKNsjLQXSnSI%3D'
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("图片下载失败");
    const blob = await response.blob();
    const file = new File([blob], "auto-upload.png", { type: "image/png" });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputElement.files = dataTransfer.files;

    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
  } catch (e) {
    console.error("[AutoUpload] 自动上传图片失败:", e);
  }
}
// --- Initialization ---

// 监控两个目标元素的监控器
function startElementWatcher() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const dataTestId = node.getAttribute ? node.getAttribute('data-testid') : null;
            
            if (dataTestId === 'chat_input_input' || dataTestId === 'upload-file-input') {
              // 目标元素已找到
            }
            
            if (node.querySelectorAll) {
              const chatInputElements = node.querySelectorAll('[data-testid="chat_input_input"]');
              const uploadElements = node.querySelectorAll('[data-testid="upload-file-input"]');
              
              if (chatInputElements.length > 0 || uploadElements.length > 0) {
                // 子元素中找到目标元素
              }
            }
          }
        });
      }
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  return observer;
}

// 立即检查目标元素是否存在
function checkElementImmediately() {
  const chatInputElement = document.querySelector(CHAT_INPUT_SELECTOR);
  if (chatInputElement) {
    chatInputFound = true;
  }
  
  const uploadElement = document.querySelector(UPLOAD_FILE_INPUT_SELECTOR);
  if (uploadElement) {
    uploadElementFound = true;
  }
}

window.addEventListener("load", () => {
  createDownloadButton();
  updateTabStatus("idle");
  checkElementImmediately();
  startElementWatcher();

  // 定期检查目标元素（每2秒检查一次，最多检查10次）
  let checkCount = 0;
  const maxChecks = 10;
  let chatInputFound = false;
  let uploadElementFound = false;
  
  const checkInterval = setInterval(() => {
    checkCount++;
    
    const chatInputElement = document.querySelector(CHAT_INPUT_SELECTOR);
    const uploadElement = document.querySelector(UPLOAD_FILE_INPUT_SELECTOR);
    
    if (chatInputElement && !chatInputFound) {
      chatInputFound = true;
    }
    
    if (uploadElement && !uploadElementFound) {
      uploadElementFound = true;
    }
    
    if ((chatInputFound && uploadElementFound) || checkCount >= maxChecks) {
      clearInterval(checkInterval);
    }
  }, 2000);
});

// --- Cleanup ---
window.addEventListener("beforeunload", () => {
  clearTimeout(imageCollectionTimer);
  updateTabStatus("idle");
});

// 创建下载按钮
function createDownloadButton() {
  if (downloadButton) {
    return;
  }

  // 创建按钮元素
  downloadButton = document.createElement("button");
  downloadButton.textContent = "无水印下载";
  downloadButton.style.cssText = `
        position: fixed;
        top: 10px;
        right: 150px;
        padding: 10px 20px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        z-index: 9999;
        font-size: 12px;
    `;

  // 添加悬停效果
  downloadButton.addEventListener("mouseover", () => {
    downloadButton.style.backgroundColor = "#45a049";
  });
  downloadButton.addEventListener("mouseout", () => {
    downloadButton.style.backgroundColor = "#4CAF50";
  });

  // 添加点击事件
  downloadButton.addEventListener("click", async () => {
    if (downloadImageUrls.length === 0) {
      alert("没有可下载的图片");
      return;
    }
    showImageDownloadModal();
  });

  document.body.appendChild(downloadButton);
}

// 更新下载按钮状态
function updateDownloadButton() {
  if (!downloadButton) {
    createDownloadButton();
  }

  if (downloadImageUrls.length > 0) {
    downloadButton.style.display = "block";
    downloadButton.textContent = `下载图片 (${downloadImageUrls.length})`;
  } else {
    downloadButton.style.display = "none";
  }
}

// 添加弹窗相关函数
function showImageDownloadModal() {
  // 遮罩层和弹窗只创建一次
  let modalOverlay = document.getElementById("image-download-modal-overlay");
  let modal = document.getElementById("image-download-modal");

  if (!modalOverlay) {
    // 创建遮罩层
    modalOverlay = document.createElement("div");
    modalOverlay.id = "image-download-modal-overlay";
    modalOverlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.4);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
    document.body.appendChild(modalOverlay);
  }
  modalOverlay.style.display = "flex";

  if (!modal) {
    // 创建弹窗主体
    modal = document.createElement("div");
    modal.id = "image-download-modal";
    modal.style.cssText = `
            background: #fff;
            border-radius: 12px;
            padding: 24px 20px 16px 20px;
            max-width: 700px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 24px rgba(0,0,0,0.18);
            position: relative;
        `;
    modalOverlay.appendChild(modal);
  }
  modal.style.display = "block";

  // 清空弹窗内容
  modal.innerHTML = "";

  // 关闭按钮
  const closeBtn = document.createElement("span");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 18px;
        font-size: 24px;
        color: #888;
        cursor: pointer;
        font-weight: bold;
    `;
  closeBtn.onclick = hideImageDownloadModal;
  modal.appendChild(closeBtn);

  // 标题
  const title = document.createElement("div");
  title.textContent = "选择要下载的图片";
  title.style.cssText =
    "font-size: 18px; font-weight: bold; margin-bottom: 18px;";
  modal.appendChild(title);

  // 图片列表
  const imgList = document.createElement("div");
  imgList.style.cssText =
    "display: flex; flex-wrap: wrap; gap: 18px; justify-content: flex-start;";

  if (downloadImageUrls.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "没有可下载的图片";
    imgList.appendChild(empty);
  } else {
    downloadImageUrls.forEach((url, idx) => {
      const imgBox = document.createElement("div");
      imgBox.style.cssText =
        "display: flex; flex-direction: column; align-items: center; width: 120px;";

      const img = document.createElement("img");
      img.src = url;
      img.alt = `image_${idx + 1}`;
      img.style.cssText =
        "width: 100px; height: 100px; object-fit: contain; border: 1px solid #eee; border-radius: 8px; margin-bottom: 8px; background: #fafafa;";

      const btn = document.createElement("button");
      btn.textContent = "下载";
      btn.style.cssText =
        "padding: 4px 12px; font-size: 13px; border-radius: 6px; border: none; background: #4CAF50; color: #fff; cursor: pointer;";
      btn.onclick = () => downloadSingleImage(url, idx);

      imgBox.appendChild(img);
      imgBox.appendChild(btn);
      imgList.appendChild(imgBox);
    });
  }
  modal.appendChild(imgList);

  // 全部下载按钮
  if (downloadImageUrls.length > 1) {
    const allBtn = document.createElement("button");
    allBtn.textContent = "全部下载";
    allBtn.style.cssText =
      "margin-top: 18px; margin-right: 12px; padding: 8px 24px; font-size: 15px; border-radius: 8px; border: none; background: #2196F3; color: #fff; cursor: pointer;";
    allBtn.onclick = downloadAllImages;
    modal.appendChild(allBtn);
  }
  // 清空按钮
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "清空";
  clearBtn.style.cssText =
    "margin-top: 18px; padding: 8px 24px; font-size: 15px; border-radius: 8px; border: none; background: #f44336; color: #fff; cursor: pointer;";
  clearBtn.onclick = clearAllImages;
  modal.appendChild(clearBtn);
}

function hideImageDownloadModal() {
  const overlay = document.getElementById("image-download-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

async function downloadSingleImage(url, idx) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `image_${idx + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    alert("下载失败: " + error);
  }
}

async function downloadAllImages() {
  for (let i = 0; i < downloadImageUrls.length; i++) {
    await downloadSingleImage(downloadImageUrls[i], i);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// 添加清空函数
function clearAllImages() {
  downloadImageUrls.length = 0;
  foundImageUrls.length = 0;
  processedUrls.clear();
  updateDownloadButton();
  hideImageDownloadModal();
  // 重新弹出弹窗，显示空状态
  setTimeout(showImageDownloadModal, 100);
}
