// 设置面板注入脚本
(function() {
  'use strict';
  
  // 检查是否已经存在设置面板
  if (document.getElementById('doubao-settings-panel')) {
    console.log('[SettingsPanel] Panel already exists, closing...');
    document.getElementById('doubao-settings-panel').remove();
    const overlay = document.getElementById('doubao-settings-overlay');
    if (overlay) overlay.remove();
    return;
  }
  
  console.log('[SettingsPanel] Creating settings panel...');
  
  // 创建设置面板HTML
  const panelHTML = `
    <div id="doubao-settings-panel" style="
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
        <!-- 标题栏 -->
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
          ">豆包助手设置</h1>
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
        
        <!-- 设置项 -->
        <div class="setting-item" style="
          margin-bottom: 12px;
          padding: 12px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.7);
          transition: all 0.2s ease;
        ">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="autoReload" style="margin-right: 8px; transform: scale(0.9);">
            自动刷新页面
          </label>
          <div style="color: #7f8c8d; font-size: 11px; margin-top: 4px; line-height: 1.3;">
            完成任务后自动刷新页面。如果关闭此选项，页面将保持当前状态。
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
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="clearCookies" style="margin-right: 8px; transform: scale(0.9);">
            清除Cookie
          </label>
          <div style="color: #7f8c8d; font-size: 11px; margin-top: 4px; line-height: 1.3;">
            在页面加载时自动清除所有Cookie。如果关闭此选项，Cookie将保持不变。
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
          <label for="wsUrl" style="display: block; font-weight: 500; color: #2c3e50; margin-bottom: 4px;">WebSocket 服务器地址</label>
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
            输入后端WebSocket服务器的地址 (例如: ws://localhost:8080)。
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
        
        <!-- Tab管理部分 -->
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
          ">Tab 管理</h2>
          <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 8px; line-height: 1.3;">
            查看和管理所有豆包tab的状态
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
            <!-- Tab列表将在这里动态生成 -->
          </div>
        </div>
      </div>
    </div>
  `;
  
  // 创建遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'doubao-settings-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 9999;
  `;
  
  // 插入到页面
  document.body.appendChild(overlay);
  document.body.insertAdjacentHTML('beforeend', panelHTML);
  
  // 添加事件监听器
  const panel = document.getElementById('doubao-settings-panel');
  const closeBtn = document.getElementById('close-panel');
  const overlayEl = document.getElementById('doubao-settings-overlay');
  
  // 关闭面板
  function closePanel() {
    // 清理定时器
    if (window.refreshInterval) {
      clearInterval(window.refreshInterval);
      window.refreshInterval = null;
    }
    panel.remove();
    overlayEl.remove();
  }
  
  closeBtn.addEventListener('click', closePanel);
  overlayEl.addEventListener('click', closePanel);
  
  // 阻止面板点击事件冒泡
  panel.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 加载设置面板逻辑
  loadSettingsPanel();
  
  // 设置面板逻辑
  async function loadSettingsPanel() {
    // 将基于回调的 Chrome API 转换为返回 Promise 的函数
    const promisify = (fn) => (...args) => new Promise((resolve, reject) => {
      fn(...args, (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result);
      });
    });

    // 创建 Promise 版本的 API
    const storageGet = promisify(chrome.storage.sync.get.bind(chrome.storage.sync));
    const storageSet = promisify(chrome.storage.sync.set.bind(chrome.storage.sync));
    const sendMessage = promisify(chrome.runtime.sendMessage);

    // 保存设置
    async function saveOptions() {
      const autoReload = document.getElementById('autoReload').checked;
      const clearCookies = document.getElementById('clearCookies').checked;
      const wsUrl = document.getElementById('wsUrl').value;

      try {
        await storageSet({ 
          autoReload,
          clearCookies,
          wsUrl
        });
        
        const status = document.getElementById('status');
        status.textContent = '设置已保存';
        status.style.display = 'block';
        status.style.background = 'linear-gradient(135deg, #d4edda, #c3e6cb)';
        status.style.color = '#155724';
        status.style.border = '1px solid #c3e6cb';
        setTimeout(() => {
          status.style.display = 'none';
        }, 2000);
      } catch (error) {
        console.error('Error saving options:', error);
        const status = document.getElementById('status');
        status.textContent = '保存失败';
        status.style.display = 'block';
        status.style.background = 'linear-gradient(135deg, #f8d7da, #f5c6cb)';
        status.style.color = '#721c24';
        status.style.border = '1px solid #f5c6cb';
      }
    }

    // 加载设置
    async function loadOptions() {
      try {
        const result = await storageGet(['autoReload', 'clearCookies', 'wsUrl']);
        document.getElementById('autoReload').checked = result.autoReload !== undefined ? result.autoReload : true;
        document.getElementById('clearCookies').checked = result.clearCookies !== undefined ? result.clearCookies : false;
        document.getElementById('wsUrl').value = result.wsUrl || 'ws://localhost:8080';
      } catch (error) {
        console.error('Error loading options:', error);
      }
    }

    // 获取Tab状态
    async function getTabStatus() {
      try {
        return await sendMessage({ type: 'GET_TAB_STATUS' });
      } catch (error) {
        console.error('Error getting tab status:', error);
        return null;
      }
    }

    // 格式化时间
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

    // 发送测试任务
    async function sendTestTask(tabId) {
      console.log('sendTestTask called with tabId:', tabId);
      
      const testCommand = {
        commandId: 'test-' + Date.now(),
        prompt: "画一只可爱的小猫坐在花园里，阳光明媚，花朵盛开，卡通风格，色彩鲜艳",
        ratio: "1:1",
        file: false,
        imageUrl: null,
        task_type: "image"
      };
      
      console.log('Sending test command:', testCommand);
      
      try {
        const response = await sendMessage({
          type: 'FORCE_TASK_DISPATCH',
          tabId: tabId,
          task: JSON.stringify(testCommand)
        });
        
        console.log('Response received:', response);
        
        if (response && response.success) {
          // 任务发送成功，直接关闭设置面板
          closePanel();
        } else {
          throw new Error(response?.error || '未知错误');
        }
      } catch (error) {
        console.error('Error sending test task:', error);
        alert('发送测试任务失败: ' + error.message);
      }
    }

    // 刷新Tab状态
    async function refreshTabStatus() {
      const tabsList = document.getElementById('tabsList');
      const wsStatus = document.getElementById('wsStatus');
      
      // 检查元素是否存在
      if (!tabsList || !wsStatus) {
        console.error('Required elements not found: tabsList or wsStatus');
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
        
        // 更新WebSocket状态
        let wsStatusText = `WebSocket: ${status.wsConnected ? '已连接' : '未连接'}`;
        if (status.isReconnecting) {
          wsStatusText += ` (重连中... 第${status.reconnectAttempts}次)`;
        } else if (status.reconnectAttempts > 0) {
          wsStatusText += ` (重连次数: ${status.reconnectAttempts})`;
        }
        if (status.wsState !== null) {
          const stateNames = ['连接中', '已打开', '关闭中', '已关闭'];
          wsStatusText += ` [${stateNames[status.wsState] || '未知'}]`;
        }
        
        wsStatus.textContent = wsStatusText;
        wsStatus.style.color = status.wsConnected ? '#28a745' : (status.isReconnecting ? '#ffc107' : '#dc3545');
        
        // 更新Tab列表
        if (status.tabs.length === 0) {
          tabsList.innerHTML = '<div style="color: #666; font-size: 11px;">没有活跃的豆包Tab</div>';
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
                <button class="btn-test" data-tab-id="${tab.id}" style="
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
                ">发送测试任务</button>
              </div>
            </div>
          `).join('');
          
          tabsList.innerHTML = tabsHTML;
          
          // 为所有测试按钮添加事件监听器
          const testButtons = tabsList.querySelectorAll('.btn-test');
          testButtons.forEach(button => {
            button.addEventListener('click', (e) => {
              const tabId = parseInt(e.target.getAttribute('data-tab-id'));
              sendTestTask(tabId);
            });
          });
        }
        
        // 显示队列信息
        if (status.queueLength > 0) {
          const queueInfo = document.createElement('div');
          queueInfo.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: linear-gradient(135deg, #e9ecef, #dee2e6);
            border-radius: 6px;
            font-size: 11px;
            border: 1px solid #dee2e6;
          `;
          queueInfo.innerHTML = `<strong>任务队列:</strong> ${status.queueLength} 个任务等待处理`;
          tabsList.appendChild(queueInfo);
        }
        
      } catch (error) {
        console.error('Error refreshing tab status:', error);
        tabsList.innerHTML = '<div style="color: #dc3545; font-size: 11px;">刷新状态时发生错误</div>';
      }
    }

    // 初始化
    await loadOptions();
    await refreshTabStatus();
    

    // 添加事件监听器
    document.getElementById('saveButton').addEventListener('click', saveOptions);
    document.getElementById('refreshTabs').addEventListener('click', refreshTabStatus);
    
    // 定期刷新状态
    window.refreshInterval = setInterval(refreshTabStatus, 5000);
  }
  
  console.log('[SettingsPanel] Settings panel created successfully');
})();
