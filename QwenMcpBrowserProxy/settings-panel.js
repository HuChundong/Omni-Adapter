(function() {
  'use strict';
  
  if (document.getElementById('qwen-settings-panel')) {
    document.getElementById('qwen-settings-panel').remove();
    const overlay = document.getElementById('qwen-settings-overlay');
    if (overlay) overlay.remove();
    return;
  }
  
  const panelHTML = `
    <div id="qwen-settings-panel" style="
      position: fixed;
      top: 20px;
      right: 20px;
      width: 400px;
      max-height: 80vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.2);
    ">
      <div style="
        background: rgba(255, 255, 255, 0.95);
        margin: 2px;
        border-radius: 14px;
        padding: 16px;
        max-height: calc(80vh - 4px);
        overflow-y: auto;
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(0,0,0,0.1);
        ">
          <h1 style="
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #2c3e50;
          ">Qwen文生图插件设置</h1>
          <button id="close-panel" style="
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: #7f8c8d;
            padding: 4px;
            border-radius: 4px;
            transition: all 0.2s ease;
          ">×</button>
        </div>
        
        <div class="setting-item" style="
          margin-bottom: 12px;
          padding: 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.7);
          transition: all 0.2s ease;
        ">
          <h3 style="
            color: #34495e;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
          ">WebSocket 连接</h3>
          <label for="wsUrl" style="display: block; font-weight: 500; color: #2c3e50; margin-bottom: 4px;">WebSocket 服务器 URL:</label>
          <input type="text" id="wsUrl" style="
            width: 100%;
            padding: 6px 8px;
            margin-top: 4px;
            box-sizing: border-box;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 12px;
            transition: border-color 0.2s ease;
          " placeholder="ws://localhost:8080">
          <div style="color: #7f8c8d; font-size: 11px; margin-top: 4px; line-height: 1.3;">
            输入后端WebSocket服务器的地址
          </div>
        </div>

        <div class="setting-item" style="
          margin-bottom: 12px;
          padding: 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.7);
          transition: all 0.2s ease;
        ">
          <h3 style="
            color: #34495e;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
          ">自动刷新设置</h3>
          <label style="display: flex; align-items: center; font-weight: 500; color: #2c3e50; margin-bottom: 4px;">
            <input type="checkbox" id="autoRefreshEnabled" style="
              margin-right: 8px;
              transform: scale(1.2);
            ">
            启用自动刷新页面
          </label>
          <div style="color: #7f8c8d; font-size: 11px; margin-top: 4px; line-height: 1.3;">
            开启后，每次完成任务会自动刷新页面到对应功能模式
          </div>
        </div>

        <button id="saveButton" style="
          width: 100%;
          padding: 8px 16px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          background: linear-gradient(135deg, #007bff, #0056b3);
          color: white;
          margin-bottom: 12px;
          transition: all 0.2s ease;
        ">保存设置</button>

        <div id="status" style="
          margin-top: 8px;
          padding: 8px;
          border-radius: 6px;
          display: none;
          font-size: 11px;
          font-weight: 500;
        "></div>
        
        <div class="setting-item" style="
          margin-top: 16px;
          padding: 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.7);
          transition: all 0.2s ease;
        ">
          <h2 style="
            color: #34495e;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
          ">Tab 管理与状态</h2>
          <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 8px; line-height: 1.3;">
            查看和管理所有Qwen tab的状态
          </div>
          
          <div style="margin-top: 8px;">
            <button id="refreshTabs" style="
              padding: 6px 12px;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 500;
              background: linear-gradient(135deg, #28a745, #1e7e34);
              color: white;
              margin-right: 8px;
              transition: all 0.2s ease;
            ">刷新状态</button>
            <span id="wsStatus" style="font-weight: 600; font-size: 11px;"></span>
          </div>
          
          <div id="tabsList" style="margin-top: 8px;">
          </div>
        </div>
      </div>
    </div>
  `;
  
  const overlay = document.createElement('div');
  overlay.id = 'qwen-settings-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 9999;
  `;
  
  document.body.appendChild(overlay);
  document.body.insertAdjacentHTML('beforeend', panelHTML);
  
  const panel = document.getElementById('qwen-settings-panel');
  const closeBtn = document.getElementById('close-panel');
  const overlayEl = document.getElementById('qwen-settings-overlay');
  
  function closePanel() {
    if (window.qwenRefreshInterval) {
      clearInterval(window.qwenRefreshInterval);
      window.qwenRefreshInterval = null;
    }
    panel.remove();
    overlayEl.remove();
  }
  
  closeBtn.addEventListener('click', closePanel);
  overlayEl.addEventListener('click', closePanel);
  
  panel.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  loadSettingsPanel();
  
  async function loadSettingsPanel() {
    const promisify = (fn) => (...args) => new Promise((resolve, reject) => {
      fn(...args, (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result);
      });
    });

    const storageGet = promisify(chrome.storage.sync.get.bind(chrome.storage.sync));
    const storageSet = promisify(chrome.storage.sync.set.bind(chrome.storage.sync));
    const sendMessage = promisify(chrome.runtime.sendMessage);

    async function saveOptions() {
      const wsUrl = document.getElementById('wsUrl').value;
      const autoRefreshEnabled = document.getElementById('autoRefreshEnabled').checked;
      const status = document.getElementById('status');

      try {
        // 直接使用Chrome API，不使用promisify
        await new Promise((resolve, reject) => {
          chrome.storage.sync.set({ wsUrl, autoRefreshEnabled }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        });
        
        status.textContent = "设置已保存";
        status.style.display = 'block';
        status.style.background = 'linear-gradient(135deg, #d4edda, #c3e6cb)';
        status.style.color = '#155724';
        status.style.border = '1px solid #c3e6cb';
        setTimeout(() => {
          status.style.display = 'none';
        }, 2000);
      } catch (error) {
        console.error("Failed to save options:", error);
        status.textContent = `保存失败: ${error.message}`;
        status.style.display = 'block';
        status.style.background = 'linear-gradient(135deg, #f8d7da, #f5c6cb)';
        status.style.color = '#721c24';
        status.style.border = '1px solid #f5c6cb';
      }
    }

    async function loadOptions() {
      try {
        // 直接使用Chrome API，不使用promisify
        const result = await new Promise((resolve, reject) => {
          chrome.storage.sync.get(["wsUrl", "autoRefreshEnabled"], (result) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(result);
            }
          });
        });
        
        document.getElementById('wsUrl').value = result.wsUrl || "ws://localhost:8080";
        document.getElementById('autoRefreshEnabled').checked = result.autoRefreshEnabled || false;
      } catch (error) {
        console.error("Failed to load options:", error);
        document.getElementById('wsUrl').value = "加载设置出错";
        document.getElementById('autoRefreshEnabled').checked = false;
      }
    }

    async function getTabStatus() {
      try {
        return await sendMessage({ type: "GET_TAB_STATUS" });
      } catch (error) {
        console.error("Error getting tab status:", error);
        return null;
      }
    }

    function formatLastUsed(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}小时前`;
      } else if (minutes > 0) {
        return `${minutes}分钟前`;
      } else {
        return `${seconds}秒前`;
      }
    }

    async function sendTestTask(tabId, taskType = "image") {
      let testCommand;
      
      if (taskType === "image_edit") {
        // 图像编辑测试 - 包含参考图片
        testCommand = {
          task_type: "image",
          prompt: `编辑这张图片 - ${new Date().toLocaleTimeString()}`,
          imageUrl: "https://cdn.qwenlm.ai/output/2024-05-29/66567b4097479700344d2d46/img_0_f39b78a9f10f44cab6aa2810ad31323a~tplv-a9rns2rl98-image-dark-watermark.png",
          commandId: `test-edit-${Date.now()}`,
        };
      } else {
        // 图像生成测试 - 不包含参考图片
        testCommand = {
          task_type: "image",
          prompt: `这是一个测试提示 - ${new Date().toLocaleTimeString()}`,
          ratio: "1:1",
          commandId: `test-${Date.now()}`,
        };
      }

      try {
        const response = await sendMessage({
          type: "FORCE_TASK_DISPATCH",
          tabId: tabId,
          task: JSON.stringify(testCommand),
        });

        if (response && response.success) {
          closePanel();
        } else {
          throw new Error(response?.error || "未知错误");
        }
      } catch (error) {
        console.error('Error sending test task:', error);
        alert('发送测试任务失败: ' + error.message);
      }
    }

    async function refreshTabStatus() {
      const tabsList = document.getElementById('tabsList');
      const wsStatus = document.getElementById('wsStatus');
      
      if (!tabsList || !wsStatus) {
        return;
      }
      
      try {
        const status = await getTabStatus();

        if (!status) {
          tabsList.innerHTML = '<div style="color: #dc3545; font-size: 11px;">无法获取Tab状态信息</div>';
          wsStatus.textContent = '连接状态: 未知';
          wsStatus.style.color = '#dc3545';
          return;
        }

        wsStatus.textContent = `WebSocket: ${status.wsConnected ? '已连接' : '未连接'}`;
        wsStatus.style.color = status.wsConnected ? '#28a745' : '#dc3545';

        if (status.tabs.length === 0) {
          tabsList.innerHTML = '<div style="color: #666; font-size: 11px;">没有活跃的Qwen Tab</div>';
        } else {
          const tabsHTML = status.tabs.map(tab => `
            <div class="tab-item" data-tab-id="${tab.id}" style="
              border: 1px solid rgba(0,0,0,0.08);
              border-radius: 8px;
              padding: 8px;
              margin-bottom: 6px;
              background: rgba(255, 255, 255, 0.8);
              transition: all 0.2s ease;
            ">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-weight: 600; color: #2c3e50; font-size: 12px;">Tab ID: ${tab.id}</span>
                <span class="tab-status ${tab.status}" style="
                  padding: 3px 6px;
                  border-radius: 10px;
                  font-size: 10px;
                  font-weight: 600;
                  text-transform: uppercase;
                  background: ${tab.status === 'idle' ? 'linear-gradient(135deg, #d4edda, #c3e6cb)' : 'linear-gradient(135deg, #fff3cd, #ffeaa7)'};
                  color: ${tab.status === 'idle' ? '#155724' : '#856404'};
                ">${tab.status}</span>
              </div>
              <div style="color: #7f8c8d; font-size: 11px; line-height: 1.3; margin-bottom: 6px;">
                URL: ${tab.url}<br>
                最后使用: ${formatLastUsed(tab.lastUsed)}
              </div>
              <div style="margin-top: 6px;">
                <button class="btn-test" data-tab-id="${tab.id}" data-task-type="image" style="
                  padding: 4px 8px;
                  border: none;
                  border-radius: 6px;
                  cursor: pointer;
                  margin-right: 4px;
                  font-size: 10px;
                  font-weight: 500;
                  background: linear-gradient(135deg, #17a2b8, #138496);
                  color: white;
                  transition: all 0.2s ease;
                ">测试图像生成</button>
                <button class="btn-test" data-tab-id="${tab.id}" data-task-type="image_edit" style="
                  padding: 4px 8px;
                  border: none;
                  border-radius: 6px;
                  cursor: pointer;
                  margin-right: 4px;
                  font-size: 10px;
                  font-weight: 500;
                  background: linear-gradient(135deg, #6f42c1, #5a32a3);
                  color: white;
                  transition: all 0.2s ease;
                ">测试图像编辑</button>
              </div>
            </div>
          `).join('');
          
          tabsList.innerHTML = tabsHTML;
          
          const testButtons = tabsList.querySelectorAll('.btn-test');
          testButtons.forEach(button => {
            button.addEventListener('click', (e) => {
              const tabId = parseInt(e.target.getAttribute('data-tab-id'));
              const taskType = e.target.getAttribute('data-task-type') || 'image';
              sendTestTask(tabId, taskType);
            });
          });
        }

        if (status.queueLength > 0) {
          const queueInfoDiv = document.createElement('div');
          queueInfoDiv.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: linear-gradient(135deg, #e9ecef, #dee2e6);
            border-radius: 6px;
            font-size: 11px;
            border: 1px solid #dee2e6;
          `;
          queueInfoDiv.innerHTML = `<strong>任务队列:</strong> ${status.queueLength} 个任务等待处理`;
          tabsList.appendChild(queueInfoDiv);
        }

      } catch (error) {
        console.error('Error refreshing tab status:', error);
        tabsList.innerHTML = '<div style="color: #dc3545; font-size: 11px;">刷新状态时发生错误</div>';
      }
    }

    await loadOptions();
    await refreshTabStatus();
    
    document.getElementById('saveButton').addEventListener('click', saveOptions);
    document.getElementById('refreshTabs').addEventListener('click', refreshTabStatus);
    
    window.qwenRefreshInterval = setInterval(refreshTabStatus, 5000);
  }
})();