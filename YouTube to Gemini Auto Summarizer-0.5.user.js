// ==UserScript==
// @name         YouTube 到 Gemini 自动摘要生成器 (Optimized)
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  在YouTube视频中添加按钮，点击后跳转到Gemini并自动输入提示词总结视频 (优化版)
// @author       hengyu (Optimized by Assistant)
// @match        *://www.youtube.com/*
// @match        *://gemini.google.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-start // Run earlier to catch events
// @license      MIT
// @downloadURL  https://update.greasyfork.org/scripts/XXXXX/YouTube%20to%20Gemini%20Auto%20Summarizer%20Optimized.user.js // TODO: Update URL if publishing
// @updateURL    https://update.greasyfork.org/scripts/XXXXX/YouTube%20to%20Gemini%20Auto%20Summarizer%20Optimized.meta.js // TODO: Update URL if publishing
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    // Reduced check interval for MutationObserver fallback/initial checks if needed, but Observer is primary
    const CHECK_INTERVAL_MS = 200;
    const YOUTUBE_ELEMENT_TIMEOUT_MS = 10000; // 等待YouTube元素的最大时间(毫秒)
    const GEMINI_ELEMENT_TIMEOUT_MS = 15000; // 等待Gemini元素的最大时间(毫秒)
    const GEMINI_PROMPT_EXPIRY_MS = 300000; // 提示词传输有效期5分钟
    // Removed URL_CHECK_INTERVAL_MS as we now use events

    // --- 调试日志 ---
    const DEBUG = false; // Set to true to enable detailed logs
    function debugLog(message) {
        if (DEBUG) {
            console.log(`[YT->Gemini Optimized] ${message}`);
        }
    }

    // --- 辅助函数 ---

    /**
     * Waits for one or more elements matching the selectors to appear and be visible in the DOM.
     * Prioritizes MutationObserver for efficiency, falls back to polling if needed.
     * @param {string|string[]} selectors - A CSS selector string or an array of selectors.
     * @param {number} timeoutMs - Maximum time to wait in milliseconds.
     * @param {Element} [parent=document] - The parent element to search within.
     * @returns {Promise<Element>} A promise that resolves with the found element.
     */
    function waitForElement(selectors, timeoutMs, parent = document) {
        const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
        const combinedSelector = selectorArray.join(', '); // Efficiently query all at once

        return new Promise((resolve, reject) => {
            // Check immediately in case the element is already present
            const initialElement = findVisibleElement(combinedSelector, parent);
            if (initialElement) {
                debugLog(`Element found immediately: ${combinedSelector}`);
                return resolve(initialElement);
            }

            let observer = null;
            let timeoutId = null;

            const cleanup = () => {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                    debugLog(`MutationObserver disconnected for: ${combinedSelector}`);
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            const onTimeout = () => {
                cleanup();
                debugLog(`Element not found or not visible after ${timeoutMs}ms: ${combinedSelector}`);
                reject(new Error(`Element not found or not visible: ${combinedSelector}`));
            };

            const checkNode = (node) => {
                if (node && node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the added node itself matches
                    if (node.matches(combinedSelector) && isElementVisible(node)) {
                         debugLog(`Element found via MutationObserver (direct match): ${combinedSelector}`);
                         cleanup();
                         resolve(node);
                         return true;
                    }
                    // Check if any descendant matches
                    const foundDescendant = findVisibleElement(combinedSelector, node);
                    if (foundDescendant) {
                         debugLog(`Element found via MutationObserver (descendant): ${combinedSelector}`);
                         cleanup();
                         resolve(foundDescendant);
                         return true;
                    }
                }
                return false;
            };

            timeoutId = setTimeout(onTimeout, timeoutMs);

            observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            if (checkNode(node)) return;
                        }
                    } else if (mutation.type === 'attributes') {
                        // Check if the target element itself became visible or matches now
                        if (checkNode(mutation.target)) return;
                    }
                }
                // Fallback check in case visibility changed without node addition/direct attribute change matching selector
                const element = findVisibleElement(combinedSelector, parent);
                if (element) {
                    debugLog(`Element found via MutationObserver (fallback check): ${combinedSelector}`);
                    cleanup();
                    resolve(element);
                }
            });

            observer.observe(parent === document ? document.documentElement : parent, {
                childList: true,
                subtree: true,
                attributes: true, // Observe attributes changes (like style, class, disabled)
                attributeFilter: ['style', 'class', 'disabled'] // Be specific if possible
            });
            debugLog(`MutationObserver started for: ${combinedSelector}`);
        });
    }

    /**
     * Finds the first visible element matching the selector within the parent.
     * @param {string} selector - The CSS selector.
     * @param {Element} parent - The parent element.
     * @returns {Element|null} The found visible element or null.
     */
    function findVisibleElement(selector, parent) {
        try {
            const elements = parent.querySelectorAll(selector);
            for (const el of elements) {
                if (isElementVisible(el)) {
                     // Skip disabled buttons specifically, as needed by original script
                    if (selector.includes('button') && el.disabled) {
                       continue;
                    }
                    return el;
                }
            }
        } catch (e) {
            debugLog(`Error finding element with selector "${selector}": ${e}`);
        }
        return null;
    }

    /**
     * Checks if an element is potentially visible to the user.
     * @param {Element} el - The element to check.
     * @returns {boolean} True if the element is considered visible.
     */
    function isElementVisible(el) {
        if (!el) return false;
        // Basic check: offsetWidth/Height covers display:none and zero size
        // getClientRects checks for elements like <details> summary when closed
        return (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
    }


    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            debugLog("Text copied to clipboard via modern API.");
        }).catch(err => {
            debugLog(`Clipboard API failed: ${err}, using legacy method.`);
            legacyClipboardCopy(text);
        });
    }

    function legacyClipboardCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed'; // Prevent scrolling to bottom
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            const successful = document.execCommand('copy');
            debugLog(`Legacy copy attempt: ${successful ? 'Success' : 'Fail'}`);
        } catch (err) {
            debugLog('Failed to copy to clipboard using legacy execCommand: ' + err);
        }
        document.body.removeChild(textarea);
    }

     function showNotification(elementId, message, styles, duration = 15000) {
        let existingNotification = document.getElementById(elementId);
        if (existingNotification) {
            // Clear existing timeout if replacing notification
            const existingTimeoutId = existingNotification.dataset.timeoutId;
            if (existingTimeoutId) {
                clearTimeout(parseInt(existingTimeoutId));
            }
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.id = elementId;
        // Use textContent for safety, but allow basic formatting via template literal
        notification.textContent = message; // More secure than innerText? Let's stick to textContent for now. Use innerHTML if HTML is needed, carefully.
        Object.assign(notification.style, styles);

        document.body.appendChild(notification);

        const closeButton = document.createElement('button');
        closeButton.textContent = '✕'; // Use textContent
        Object.assign(closeButton.style, {
            position: 'absolute', top: '5px', right: '10px', background: 'transparent',
            border: 'none', color: 'inherit', fontSize: '16px', cursor: 'pointer', padding: '0', lineHeight: '1'
        });
        closeButton.onclick = () => notification.remove(); // Simplified removal
        notification.appendChild(closeButton);

        const timeoutId = setTimeout(() => notification.remove(), duration);
        notification.dataset.timeoutId = timeoutId.toString(); // Store timeout ID
    }


    // --- YouTube Related ---
    const YOUTUBE_NOTIFICATION_ID = 'gemini-yt-notification';
    const YOUTUBE_NOTIFICATION_STYLE = {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0,0,0,0.85)', color: 'white', padding: '15px 35px 15px 20px', // Adjusted padding for close button
        borderRadius: '8px', zIndex: '9999', maxWidth: 'calc(100% - 40px)', textAlign: 'left',
        boxSizing: 'border-box', whiteSpace: 'pre-wrap', // Use pre-wrap for better line breaks
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    };
    const BUTTON_ID = 'gemini-summarize-btn';

    function isVideoPage() {
        // More robust check for video page
        return window.location.pathname === '/watch' && new URLSearchParams(window.location.search).has('v');
    }

    async function addSummarizeButton() {
        // 1. Check if it's a video page
        if (!isVideoPage()) {
            debugLog("Not a video page, skipping button add.");
            removeSummarizeButtonIfExists(); // Clean up if navigating away
            return;
        }

        // 2. Check if button already exists
        if (document.getElementById(BUTTON_ID)) {
            debugLog("Summarize button already exists.");
            return;
        }

        debugLog("Video page detected. Attempting to add summarize button...");

        // 3. Define potential containers (prioritize more stable ones)
        const containerSelectors = [
            // Primary button containers often near subscribe/join
            '#top-row.ytd-watch-metadata > #subscribe-button', // Insert *before* subscribe
            '#meta-contents #subscribe-button',                // Alternative path
            '#owner #subscribe-button',                       // Another path
            // Fallback locations
            '#meta-contents #top-row', // Add to the end of the top row
             '#above-the-fold #title', // Add near the title
            'ytd-watch-metadata #actions', // Near like/dislike etc.
            '#masthead #end' // Last resort in top bar
        ];

        try {
            // 4. Wait for *any* of the potential containers/anchors
            // We wait for the *anchor* element to insert *relative* to it.
            const anchorElement = await waitForElement(containerSelectors, YOUTUBE_ELEMENT_TIMEOUT_MS);
            debugLog(`Found anchor element using selector matching: ${anchorElement.tagName}[id="${anchorElement.id}"][class="${anchorElement.className}"]`);

             // Re-check if button was added concurrently while waiting
             if (document.getElementById(BUTTON_ID)) {
                 debugLog("Button was added concurrently, skipping.");
                 return;
             }

            // 5. Create the button
            const button = document.createElement('button');
            button.id = BUTTON_ID;
            button.textContent = '📝 Gemini摘要'; // Use textContent

            // Apply styles
            Object.assign(button.style, {
                backgroundColor: '#1a73e8', // Google blue
                color: 'white', border: 'none', borderRadius: '18px', // Match YT button style
                padding: '0 16px', margin: '0 8px', cursor: 'pointer', fontWeight: '500', // Medium weight
                height: '36px', // Match YT button height
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', // Match YT button font size
                zIndex: '100', // Ensure visibility
                whiteSpace: 'nowrap', // Prevent wrapping
                transition: 'background-color 0.3s ease' // Smooth hover
            });
            // Hover effect
            button.onmouseover = () => button.style.backgroundColor = '#185abc'; // Darker blue
            button.onmouseout = () => button.style.backgroundColor = '#1a73e8';

            // 6. Add click listener
            button.addEventListener('click', handleSummarizeClick);

            // 7. Insert the button
            // If we found a specific button like 'subscribe', insert before it. Otherwise, append.
             if (anchorElement.id?.includes('subscribe-button') || anchorElement.tagName === 'BUTTON') {
                 anchorElement.parentNode.insertBefore(button, anchorElement);
                 debugLog(`Button inserted before anchor: ${anchorElement.id || anchorElement.tagName}`);
             } else if (anchorElement.id === 'actions' || anchorElement.id === 'end' || anchorElement.id === 'top-row') {
                 // Append as first child for some containers, last for others might be better? Let's try first child generally
                 anchorElement.insertBefore(button, anchorElement.firstChild);
                 debugLog(`Button inserted as first child of container: ${anchorElement.id || anchorElement.tagName}`);
            } else {
                 // Default: Append to the container found
                 anchorElement.appendChild(button);
                  debugLog(`Button appended to container: ${anchorElement.id || anchorElement.tagName}`);
             }


            debugLog("Summarize button successfully added!");

        } catch (error) {
            console.error('[YT->Gemini Optimized] Failed to add summarize button:', error);
             removeSummarizeButtonIfExists(); // Clean up partial attempts if error occurs
        }
    }

    function handleSummarizeClick() {
        try {
            const youtubeUrl = window.location.href;
            // Try getting title more robustly
            const titleElement = document.querySelector('h1.ytd-watch-metadata, #video-title, #title h1');
            const videoTitle = titleElement?.textContent?.trim() || document.title.replace(/ - YouTube$/, '').trim() || 'Unknown Video';

            const prompt = `请分析这个YouTube视频: ${youtubeUrl}\n\n提供一个全面的摘要，包括主要观点、关键见解和视频中讨论的重要细节，以结构化的方式分解内容，并包括任何重要的结论或要点。`;
            debugLog(`Generated prompt for: ${videoTitle}`);

            // Store data using GM functions
            GM_setValue('geminiPrompt', prompt);
            GM_setValue('videoTitle', videoTitle);
            GM_setValue('timestamp', Date.now());

            // Open Gemini in a new tab
            window.open('https://gemini.google.com/', '_blank');
            debugLog("Opened Gemini tab.");

            // Show notification on YouTube page
            const notificationMessage = `
已跳转到 Gemini！
系统将尝试自动输入提示词并发送请求。

视频: "${videoTitle}"

(如果自动操作失败，提示词已复制到剪贴板，请手动粘贴)
            `.trim();
            showNotification(YOUTUBE_NOTIFICATION_ID, notificationMessage, YOUTUBE_NOTIFICATION_STYLE, 10000); // 10 second duration

            // Copy to clipboard as fallback
            copyToClipboard(prompt);

        } catch (error) {
            console.error("[YT->Gemini Optimized] Error during summarize button click:", error);
            showNotification(YOUTUBE_NOTIFICATION_ID, `创建摘要时出错: ${error.message}`, { ...YOUTUBE_NOTIFICATION_STYLE, backgroundColor: '#d93025', color: 'white' }, 10000);
        }
    }

    function removeSummarizeButtonIfExists() {
        const button = document.getElementById(BUTTON_ID);
        if (button) {
            button.remove();
            debugLog("Removed existing summarize button.");
        }
    }


    // --- Gemini Related ---
    const GEMINI_NOTIFICATION_ID = 'gemini-auto-notification';
    const GEMINI_NOTIFICATION_STYLES = {
        info: { backgroundColor: '#e8f4fd', color: '#1967d2', border: '1px solid #a8c7fa' }, // Google info blue
        warning: { backgroundColor: '#fef7e0', color: '#a56300', border: '1px solid #fdd663' }, // Google warning yellow
        error: { backgroundColor: '#fce8e6', color: '#c5221f', border: '1px solid #f7a7a5' }  // Google error red
    };
    const BASE_GEMINI_NOTIFICATION_STYLE = {
        position: 'fixed', bottom: '20px', right: '20px', padding: '15px 35px 15px 20px', // Adjusted padding
        borderRadius: '8px', zIndex: '9999', maxWidth: '350px', textAlign: 'left',
        boxSizing: 'border-box', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', whiteSpace: 'pre-wrap'
    };

    function showGeminiNotification(message, type = "info") {
        const style = { ...BASE_GEMINI_NOTIFICATION_STYLE, ...(GEMINI_NOTIFICATION_STYLES[type] || GEMINI_NOTIFICATION_STYLES.info) };
        showNotification(GEMINI_NOTIFICATION_ID, message, style, 12000); // 12 second duration
    }

    async function handleGeminiPage() {
        debugLog("Gemini page detected. Checking for pending prompt...");

        const prompt = GM_getValue('geminiPrompt', '');
        const timestamp = GM_getValue('timestamp', 0);
        const videoTitle = GM_getValue('videoTitle', 'N/A');

        // Clean up expired/invalid data immediately
        if (!prompt || Date.now() - timestamp > GEMINI_PROMPT_EXPIRY_MS) {
            debugLog("No valid prompt found or prompt expired.");
            GM_deleteValue('geminiPrompt');
            GM_deleteValue('timestamp');
            GM_deleteValue('videoTitle');
            return;
        }

        debugLog("Valid prompt found. Waiting for Gemini input area...");
        showGeminiNotification(`检测到来自 YouTube 的请求...\n视频: "${videoTitle}"`, "info");

        // Define selectors for input area and send button
        const textareaSelectors = [
            // More specific selectors first
             'div.input-area > div.input-box > div[contenteditable="true"]', // Common structure
             'div[role="textbox"][contenteditable="true"]',
             'textarea[aria-label*="Prompt"]', // Less common but possible
            // Broader fallbacks
            'div[contenteditable="true"]',
            'textarea'
        ];
        const sendButtonSelectors = [
            // More specific selectors first
            'button[aria-label*="Send message"], button[aria-label*="发送消息"]', // Common aria-labels
            'button:has(span[class*="send-icon"])', // Structure based
             'button.send-button', // Potential class
            // Fallbacks (less reliable, might match other buttons)
            'button:has(mat-icon[data-mat-icon-name="send"])', // Material icon (keep as fallback)
            'button[aria-label="Run"], button[aria-label="Submit"]'
        ];

        try {
            // Wait for the input area
            const textarea = await waitForElement(textareaSelectors, GEMINI_ELEMENT_TIMEOUT_MS);
            debugLog("Found input area. Inserting prompt.");

            // --- Input Prompt ---
            textarea.focus();
             let inputSuccess = false;
             if (textarea.isContentEditable) {
                 textarea.textContent = prompt; // Use textContent for contenteditable
                 inputSuccess = true;
             } else if (textarea.tagName === 'TEXTAREA') {
                 textarea.value = prompt;
                 inputSuccess = true;
             }

            if (!inputSuccess) {
                 throw new Error("Could not determine how to input text into the found element.");
             }

            // Trigger input event to ensure Gemini UI updates (e.g., enables send button)
             textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
             textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); // Also trigger change
             debugLog("Prompt inserted and events dispatched.");

             // Short delay to allow UI to potentially update (e.g., enabling send button)
             await new Promise(resolve => setTimeout(resolve, 150)); // Slightly longer? 150ms

             // --- Find and Click Send Button ---
            debugLog("Waiting for send button to be enabled...");
            const sendButton = await waitForElement(sendButtonSelectors, GEMINI_ELEMENT_TIMEOUT_MS);

            // Check if button is truly clickable (not disabled)
             if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
                 debugLog("Send button found but is disabled. Waiting a bit longer...");
                 await new Promise(resolve => setTimeout(resolve, 500)); // Wait half a second more
                 if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
                     throw new Error("Send button remained disabled.");
                 }
                 debugLog("Send button became enabled after waiting.");
             }

            debugLog("Clicking send button...");
            sendButton.click();

             // --- Success ---
            debugLog("Successfully sent prompt to Gemini.");
             const successMessage = `
已自动发送视频摘要请求！
正在为视频分析做准备:
"${videoTitle}"

请稍候...
             `.trim();
            showGeminiNotification(successMessage, "info");

            // Clean up stored data after successful submission
            GM_deleteValue('geminiPrompt');
            GM_deleteValue('timestamp');
            GM_deleteValue('videoTitle');

        } catch (error) {
             console.error('[YT->Gemini Optimized] Error handling Gemini page:', error);
             showGeminiNotification(`自动操作失败: ${error.message}\n\n提示词已复制到剪贴板，请手动粘贴并发送。`, "error");
             copyToClipboard(prompt); // Ensure clipboard has the prompt on error
             // Optionally clear GM values even on error to prevent retries on refresh? Or keep them? Let's clear them.
            GM_deleteValue('geminiPrompt');
            GM_deleteValue('timestamp');
            GM_deleteValue('videoTitle');
        }
    }

    // --- Main Execution Logic ---

    debugLog("Script starting execution...");

    if (window.location.hostname.includes('www.youtube.com')) {
        debugLog("YouTube domain detected.");

        // Initial check in case the script loads after the page is ready
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            addSummarizeButton();
        } else {
            window.addEventListener('DOMContentLoaded', addSummarizeButton, { once: true });
        }

        // Listen for YouTube's specific navigation events (more reliable than URL polling)
        // 'yt-navigate-finish' fires after navigation and content update
        window.addEventListener('yt-navigate-finish', () => {
             debugLog("yt-navigate-finish event detected.");
             // Use requestAnimationFrame to ensure layout is likely stable after event
             requestAnimationFrame(addSummarizeButton);
            //setTimeout(addSummarizeButton, 50); // Small delay can sometimes help ensure elements are ready
        });

         // Also handle popstate for browser back/forward
         window.addEventListener('popstate', () => {
             debugLog("popstate event detected.");
             requestAnimationFrame(addSummarizeButton);
             //setTimeout(addSummarizeButton, 50);
         });

        // We might not need pushState override if yt-navigate-finish works reliably
        /*
        const originalPushState = history.pushState;
        history.pushState = function() {
            originalPushState.apply(this, arguments);
            debugLog("history.pushState detected.");
            // Use rAF here too
            requestAnimationFrame(addSummarizeButton);
            // setTimeout(addSummarizeButton, 50);
        };
        */


    } else if (window.location.hostname.includes('gemini.google.com')) {
        debugLog("Gemini domain detected.");

        // Handle Gemini logic once the DOM is ready
         if (document.readyState === 'complete' || document.readyState === 'interactive') {
             handleGeminiPage();
         } else {
             window.addEventListener('DOMContentLoaded', handleGeminiPage, { once: true });
         }

    } else {
         debugLog(`Script loaded on unrecognized domain: ${window.location.hostname}`);
     }

})();
