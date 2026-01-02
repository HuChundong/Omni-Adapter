const CHAT_INPUT_SELECTOR = '[data-testid="chat_input_input"]';
const UPLOAD_FILE_INPUT_SELECTOR = '[id="filesUpload"]';
const IMAGE_COLLECTION_SETTLE_DELAY_MS = 3000; // 减少延迟

// 自动刷新页面开关，默认关闭
let autoRefreshEnabled = false;

// 发送原图开关，默认开启
let sendOriginalImage = true;

// 图片收集相关
let foundImageUrls = [];
let processedUrls = new Set();
let imageCollectionTimer = null;
let imageObserver = null;

// 切换自动刷新开关
function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;
  return autoRefreshEnabled;
}

// 设置自动刷新开关
function setAutoRefresh(enabled) {
  autoRefreshEnabled = enabled;
  return autoRefreshEnabled;
}

// 从存储中加载自动刷新设置
async function loadAutoRefreshSetting() {
  try {
    const result = await chrome.storage.sync.get(['autoRefreshEnabled']);
    autoRefreshEnabled = result.autoRefreshEnabled || false;
  } catch (error) {
    console.error("[AutoRefresh] Failed to load setting:", error);
    autoRefreshEnabled = false;
  }
}

// 从存储中加载发送原图设置
async function loadSendOriginalImageSetting() {
  try {
    const result = await chrome.storage.sync.get(['sendOriginalImage']);
    // 如果从未设置过，默认为 true
    sendOriginalImage = result.sendOriginalImage !== undefined ? result.sendOriginalImage : true;
  } catch (error) {
    console.error("[SendOriginalImage] Failed to load setting:", error);
    sendOriginalImage = true; // 默认开启
  }
}

// 处理图片 URL，如果启用发送原图，去除 x-oss-process 参数
function processImageUrl(url) {
  if (!url) return url;
  
  if (sendOriginalImage) {
    // 去除 &x-oss-process=image/resize,m_mfit,w_450,h_450 或类似的参数
    try {
      const urlObj = new URL(url);
      // 移除 x-oss-process 查询参数
      urlObj.searchParams.delete('x-oss-process');
      const processedUrl = urlObj.toString();
      console.log("[ImageCollection] Processed URL (removed x-oss-process):", processedUrl);
      return processedUrl;
    } catch (error) {
      console.error("[ImageCollection] Failed to process URL:", error);
      // 如果 URL 解析失败，尝试简单的字符串替换
      return url.replace(/[&?]x-oss-process=[^&]*/gi, '');
    }
  }
  
  return url;
}

let extensionContextValid = true;

function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id;
  } catch (error) {
    extensionContextValid = false;
    return false;
  }
}

function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) {
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


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COMMAND_FROM_SERVER" && message.data) {
    try {
      const command = JSON.parse(message.data);
      if (command.task_type === "image" && command.prompt) {
        handleImageCommand(command);
      } else {
        sendErrorToBackground("Unsupported command format", command);
        notifyTaskCompleted();
      }
    } catch (e) {
      console.error("[Content] Failed to parse command JSON:", e, message.data);
      sendErrorToBackground("Failed to parse command JSON.", { error: e.message, data: message.data });
      notifyTaskCompleted();
    }
  }
  sendResponse({ success: true });
  return true;
});

function notifyTaskCompleted() {
  safeSendMessage({ type: "TASK_COMPLETED" });
}

function sendErrorToBackground(message, details = {}) {
  safeSendMessage({
    type: "ERROR_FROM_CONTENT",
    error: { message, details }
  });
}

function updateTabStatus(status) {
  safeSendMessage({ type: "TAB_STATUS_UPDATE", status: status });
}

function sendCollectedImagesToBackground() {
  imageCollectionTimer = null;
  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }

  if (foundImageUrls.length > 0) {
    // 在最终发送之前处理 URL（如果启用发送原图，去除处理参数）
    const processedImageUrls = foundImageUrls.map(url => processImageUrl(url));
    
    // 在控制台输出收集到的 URL，方便调试
    console.log("[ImageCollection] Collected image URLs (original):", foundImageUrls);
    if (processedImageUrls.some((url, index) => url !== foundImageUrls[index])) {
      console.log("[ImageCollection] Processed URLs (removed x-oss-process):", processedImageUrls);
    }
    
    safeSendMessage({
      type: "COLLECTED_IMAGE_URLS",
      urls: processedImageUrls,
    });
  } else {
    console.log("[ImageCollection] No image URLs collected");
  }

  foundImageUrls.length = 0;
  processedUrls.clear();
  
  // 只有在自动刷新启用时才重定向
  if (autoRefreshEnabled) {
    setTimeout(() => {
      redirectToImageMode();
    }, 1000);
  }
}

function onImageFound(url) {
  if (findChatInput() !== null) {
    if (!processedUrls.has(url)) {
      processedUrls.add(url);
      // 只保留最后一张图片，清空之前的（保持原始URL用于去重）
      foundImageUrls = [url];
      console.log("[ImageCollection] Found new image URL:", url);
    }
    
    clearTimeout(imageCollectionTimer);
    imageCollectionTimer = setTimeout(sendCollectedImagesToBackground, IMAGE_COLLECTION_SETTLE_DELAY_MS);
  }
}

function observeNewImagesWithOutputURL(callback) {
  if (imageObserver) {
    imageObserver.disconnect();
  }

  // 查找聊天容器
  let chatContainer = document.getElementById('chat-container');
  
  if (!chatContainer) {
    // 如果容器不存在，先监听整个文档来等待容器出现
    imageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 检查是否是聊天容器
              if (node.id === 'chat-container') {
                chatContainer = node;
                // 重新启动监听器，这次监听特定容器
                setTimeout(() => observeNewImagesWithOutputURL(callback), 100);
                return;
              }
              
              // 检查容器内的图片
              const images = node.matches('img') ? [node] : node.querySelectorAll('img');
              images.forEach(img => {
                if (img.src && img.src.startsWith("https://cdn.qwenlm.ai/output")) {
                  callback(img.src);
                }
              });
            }
          }
        }
        
        // 处理属性变化
        if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG' && mutation.attributeName === 'src') {
          const img = mutation.target;
          if (img.src && img.src.startsWith("https://cdn.qwenlm.ai/output")) {
            callback(img.src);
          }
        }
      }
    });

    imageObserver.observe(document.body, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
    return;
  }

  imageObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // 处理新增的节点
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const images = node.matches('img') ? [node] : node.querySelectorAll('img');
          images.forEach(img => {
            if (img.src && img.src.startsWith("https://cdn.qwenlm.ai/output")) {
              callback(img.src);
            }
          });
        }
      }
      
      // 处理属性变化（图片通过修改src属性加载）
      if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG' && mutation.attributeName === 'src') {
        const img = mutation.target;
        if (img.src && img.src.startsWith("https://cdn.qwenlm.ai/output")) {
          callback(img.src);
        }
      }
    }
  });

  // 只监听聊天容器内的变化
  imageObserver.observe(chatContainer, { 
    childList: true, 
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });
}

function findChatInput() {
  return document.getElementById("chat-input");
}

function findUploadFileInput() {
  return document.getElementById("filesUpload");
}

async function handleImageCommand(command) {
  updateTabStatus("busy");

  const inputElement = findChatInput();
  if (!inputElement) {
    console.error("[Input] Chat input element not found.");
    sendErrorToBackground("Chat input element not found.");
    updateTabStatus("idle");
    notifyTaskCompleted();
    return;
  }

  try {
    inputElement.focus();
    
    // 判断是否有参考图片，决定是图像编辑还是图像生成
    const hasReferenceImage = !!(command.file || command.imageUrl);
    
    if (hasReferenceImage) {
      await gotoImageEditMode();
    } else {
      await gotoImageMode();
    }
    
    // 等待功能切换完成
    await new Promise(r => setTimeout(r, 1000));

    // 如果有参考图片，先上传
    if (hasReferenceImage) {
      const imageUrl = command.file || command.imageUrl;
      const uploadSuccess = await upload_files(imageUrl);
      if (uploadSuccess) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw new Error("Failed to upload reference image");
      }
    }

    // 设置比例（仅图像生成需要）
    if (!hasReferenceImage && command.ratio) {
      await changeRatio(command.ratio);
      await new Promise(r => setTimeout(r, 1000));
    }

    // 设置提示词
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeInputValueSetter.call(inputElement, command.prompt);
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise(r => setTimeout(r, 500));

    const sendSuccess = await sendMessage();
    if (sendSuccess) {
      observeNewImagesWithOutputURL(onImageFound);
    } else {
      throw new Error("Failed to click send button.");
    }
  } catch (e) {
    console.error("[Input] Error during image command execution:", e);
    sendErrorToBackground("Image command execution failed.", { error: e.message, command: command });
    updateTabStatus("idle");
    notifyTaskCompleted();
  }
}

async function waitForUploadComplete() {
  const maxWaitTime = 30000; // 30秒超时
  const checkInterval = 500; // 每500ms检查一次
  let elapsedTime = 0;
  
  // 获取input元素
  const inputElement = findUploadFileInput();
  if (!inputElement) {
    return false;
  }
  
  // 获取input的父容器，用于查找兄弟DOM
  const parentContainer = inputElement.parentElement;
  if (!parentContainer) {
    return false;
  }
  
  while (elapsedTime < maxWaitTime) {
    // 检查是否还在上传中（有spinner）
    const uploadingSpinner = parentContainer.querySelector('.spinner_ajPY');
    if (uploadingSpinner) {
      await new Promise(r => setTimeout(r, checkInterval));
      elapsedTime += checkInterval;
      continue;
    }
    
    // 检查是否在上传中（通过检测 "image" 和 ".png" 文本）
    const uploadingText = Array.from(parentContainer.querySelectorAll('div')).find(div => 
      div.textContent && 
      div.textContent.includes('image') && 
      div.textContent.includes('.png') && 
      !div.querySelector('img')
    );
    
    if (uploadingText) {
      await new Promise(r => setTimeout(r, checkInterval));
      elapsedTime += checkInterval;
      continue;
    }
    
    // 检查是否出现上传完成的图片元素
    const completedImage = parentContainer.querySelector('img[src*="qwen-webui-prod.oss-accelerate.aliyuncs.com"]');
    if (completedImage) {
      return true;
    }
    
    // 检查是否有图片预览元素
    const previewImage = parentContainer.querySelector('.media img');
    if (previewImage) {
      return true;
    }
    
    // 等待一段时间再检查
    await new Promise(r => setTimeout(r, checkInterval));
    elapsedTime += checkInterval;
  }
  
  console.warn("[Upload] Upload timeout after 30 seconds");
  return false;
}

async function upload_files(url) {
  if (!url || !url.startsWith("http")) {
    return false;
  }
  
  let inputElement = findUploadFileInput();
  
  // 等待上传元素出现
  if (!inputElement) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    inputElement = findUploadFileInput();
  }
  
  if (!inputElement) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    inputElement = findUploadFileInput();
  }
  
  if (!inputElement) {
    return false;
  }
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image download failed: ${response.statusText}`);
    
    const blob = await response.blob();
    
    // 检查blob是否为空
    if (blob.size === 0) {
      return false;
    }
    
    // 创建文件对象
    const file = new File([blob], "auto-upload.png", { type: "image/png" });

    // 使用DataTransfer API上传文件
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputElement.files = dataTransfer.files;

    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    
    // 等待上传完成
    const uploadSuccess = await waitForUploadComplete();
    
    return uploadSuccess;
  } catch (e) {
    console.error("[Upload] Failed to auto-upload image:", e);
    return false;
  }
}

// 查找并点击可点击的元素（包括子元素）
function clickElement(element) {
  if (!element) return false;
  
  // 优先查找 button 或 a 标签
  const buttonChild = element.querySelector('button, a');
  if (buttonChild) {
    buttonChild.click();
    return true;
  }
  
  // 如果没有找到 button/a，查找所有子元素，找到有点击事件监听器的元素
  const allChildren = Array.from(element.querySelectorAll('*'));
  const elementWithClickHandler = allChildren.find(el => {
    // 检查元素是否有 onclick 属性或事件监听器
    return el.onclick !== null || 
           (el.getAttribute && el.getAttribute('onclick')) ||
           el.style.cursor === 'pointer';
  });
  
  if (elementWithClickHandler) {
    elementWithClickHandler.click();
    return true;
  }
  
  // 如果都没找到，直接点击元素本身
  element.click();
  return true;
}

async function changeRatio(ratio) {
  // 先查找比例选择按钮
  let sizeSelectorBtn = document.querySelector(".size-selector-btn");
  
  // 如果没找到，尝试查找包含 size-selector-btn class 的按钮
  if (!sizeSelectorBtn) {
    sizeSelectorBtn = document.querySelector("button.size-selector-btn");
  }
  
  // 如果还是没找到，尝试在 chat-input-feature-btn 附近查找
  if (!sizeSelectorBtn) {
    const featureBtn = document.querySelector(".chat-input-feature-btn");
    if (featureBtn) {
      const container = featureBtn.closest("div");
      if (container) {
        sizeSelectorBtn = container.querySelector(".size-selector-btn") || 
                         container.querySelector("button.size-selector-btn");
      }
    }
  }
  
  if (!sizeSelectorBtn) {
    console.error("[Ratio] Size selector button not found");
    return false;
  }

  // 在比例选择按钮内部查找 ant-dropdown-trigger 子元素
  const triggerContainer = sizeSelectorBtn.querySelector(".ant-dropdown-trigger");
  
  if (!triggerContainer) {
    console.error("[Ratio] ant-dropdown-trigger not found inside size-selector-btn");
    return false;
  }

  // 元素本身就是可点击的，直接点击
  triggerContainer.click();
  await new Promise(r => setTimeout(r, 500));

  // 查找可见的菜单，不依赖 data-state 属性
  const menus = Array.from(document.querySelectorAll('[role="menu"]'));
  const menu = menus.find(m => {
    const style = window.getComputedStyle(m);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  });
  
  if (!menu) {
    console.error("[Ratio] Menu not found after clicking trigger button");
    return false;
  }
  
  // 遍历所有菜单项，检查每个子元素的文本内容来匹配比例，不依赖特定 class
  const menuItems = Array.from(menu.querySelectorAll('li[role="menuitem"]'));
  const menuItem = menuItems.find(item => {
    // 遍历所有子元素（包括自身），检查文本内容是否包含比例
    const allElements = [item, ...Array.from(item.querySelectorAll('*'))];
    return allElements.some(el => {
      const text = el.textContent || el.innerText || '';
      return text.trim().includes(ratio);
    });
  });
  
  if (menuItem) {
    menuItem.click();
    return true;
  }
  
  console.error(`[Ratio] Menu item with ratio "${ratio}" not found`);
  triggerContainer.click(); // 关闭菜单
  return false;
}

function redirectToImageMode() {
  const imageModeUrl = "https://chat.qwen.ai/?inputFeature=t2i";
  if (window.location.href !== imageModeUrl) {
    window.location.href = imageModeUrl;
  }
}

function redirectToImageEditMode() {
  const imageEditModeUrl = "https://chat.qwen.ai/?inputFeature=image_edit";
  if (window.location.href !== imageEditModeUrl) {
    window.location.href = imageEditModeUrl;
  }
}

async function gotoImageMode() {
  return await switchToFunction("图像生成");
}

async function gotoImageEditMode() {
  return await switchToFunction("图像编辑");
}

async function switchToFunction(functionName) {
  // 检查是否需要使用URL重定向
  const needRedirect = await checkIfNeedRedirect();
  
  if (needRedirect) {
    if (functionName === "图像生成") {
      redirectToImageMode();
    } else if (functionName === "图像编辑") {
      redirectToImageEditMode();
    }
    return true;
  } else {
    return await clickFunctionButton(functionName);
  }
}

async function checkIfNeedRedirect() {
  // 查找返回按钮元素
  const backButton = document.querySelector('#chat-message-input-func-type');
  
  if (!backButton) {
    return false;
  }
  
  // 检查按钮是否被禁用
  if (backButton.classList.contains('disabled')) {
    return true;
  }
  
  return false;
}

async function clickFunctionButton(functionName) {
  // 首先检查当前选中的功能
  const currentFuncText = document.querySelector('.prompt-input-input-func-type-text');
  
  if (currentFuncText) {
    const currentText = currentFuncText.innerText.trim();
    // 如果当前功能匹配，不需要切换
    if (currentText === functionName) {
      return true;
    }
    // 如果当前功能不匹配，点击该元素返回到功能选择页面
    currentFuncText.click();
    await new Promise(r => setTimeout(r, 500));
  }
  
  // 查找指定功能的按钮
  // 功能按钮是 .chat-prompt-suggest-button，功能文本在内部的 div 中
  const buttons = Array.from(document.querySelectorAll('.chat-prompt-suggest-button'));
  const button = buttons.find(btn => {
    // 跳过 disabled 的按钮
    if (btn.classList.contains('disabled')) {
      return false;
    }
    // 查找内部包含功能文本的 div
    const divs = btn.querySelectorAll('div');
    return Array.from(divs).some(div => {
      const text = div.innerText.trim();
      return text === functionName;
    });
  });

  if (button) {
    button.click();
    await new Promise(r => setTimeout(r, 1000));
    return true;
  }
  
  return false;
}


async function sendMessage() {
  // 使用新的选择器查找发送按钮
  let sendButton = document.querySelector("button.send-button");
  
  // 如果没找到，尝试通过父容器查找
  if (!sendButton) {
    const container = document.querySelector(".chat-prompt-send-button");
    if (container) {
      sendButton = container.querySelector("button.send-button");
    }
  }
  
  if (sendButton && !sendButton.disabled) {
    sendButton.click();
    return true;
  }
  return false;
}

window.addEventListener("load", () => {
  updateTabStatus("idle");
  // 加载自动刷新设置
  loadAutoRefreshSetting();
  // 加载发送原图设置
  loadSendOriginalImageSetting();
});

window.addEventListener("beforeunload", () => {
  clearTimeout(imageCollectionTimer);
  if (imageObserver) imageObserver.disconnect();
});