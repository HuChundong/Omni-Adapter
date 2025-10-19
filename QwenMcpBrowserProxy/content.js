const CHAT_INPUT_SELECTOR = '[data-testid="chat_input_input"]';
const UPLOAD_FILE_INPUT_SELECTOR = '[id="filesUpload"]';
const IMAGE_COLLECTION_SETTLE_DELAY_MS = 3000; // 减少延迟

// 自动刷新页面开关，默认关闭
let autoRefreshEnabled = false;

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
    safeSendMessage({
      type: "COLLECTED_IMAGE_URLS",
      urls: [...foundImageUrls],
    });
  }

  foundImageUrls.length = 0;
  processedUrls.clear();
  
  setTimeout(() => {
    redirectToImageMode();
  }, 1000);
}

function onImageFound(url) {
  if (findChatInput() !== null) {
    if (!processedUrls.has(url)) {
      processedUrls.add(url);
      // 只保留最后一张图片，清空之前的
      foundImageUrls = [url];
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

async function changeRatio(ratio) {
  const triggerButton = document.querySelector(".chat-ratio-selector")?.closest("button[data-menu-trigger]");
  if (!triggerButton) {
    return false;
  }

  triggerButton.click();
  await new Promise(r => setTimeout(r, 500));

  const menu = document.querySelector('div[role="menu"][data-state="open"]');
  if (!menu) {
    return false;
  }
  
  const menuItem = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(item => item.innerText.trim() === ratio);
  if (menuItem) {
    menuItem.click();
    return true;
  }
  
  triggerButton.click();
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
  // 首先点击返回按钮（如果存在且未禁用）
  const backButton = document.querySelector('#chat-message-input-func-type');
  if (backButton && !backButton.classList.contains('disabled')) {
    backButton.click();
    await new Promise(r => setTimeout(r, 500));
  }
  
  // 查找指定功能的按钮
  const button = Array.from(document.querySelectorAll("button.chat-prompt-suggest-button.normal"))
    .find(btn => {
      const textDiv = btn.querySelector('div');
      return textDiv && textDiv.innerText.trim() === functionName;
    });

  if (button) {
    button.click();
    await new Promise(r => setTimeout(r, 1000));
    return true;
  }
  
  return false;
}


async function sendMessage() {
  const sendButton = document.getElementById("send-message-button");
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
});

window.addEventListener("beforeunload", () => {
  clearTimeout(imageCollectionTimer);
  if (imageObserver) imageObserver.disconnect();
});