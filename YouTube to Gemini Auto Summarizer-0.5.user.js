// ==UserScript==
// @name         YouTube to Gemini Auto Summarizer 
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  在YouTube视频中添加按钮，点击后跳转到Gemini并自动输入提示词总结视频 (Optimized for speed)
// @author       hengyu (Optimized by Assistant)
// @match        *://www.youtube.com/watch?*
// @match        *://gemini.google.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// @license      MIT  
// @downloadURL https://update.greasyfork.org/scripts/535000/YouTube%20to%20Gemini%20Auto%20Summarizer.user.js
// @updateURL https://update.greasyfork.org/scripts/535000/YouTube%20to%20Gemini%20Auto%20Summarizer.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const CHECK_INTERVAL_MS = 100; // How often to check for elements (milliseconds)
    const YOUTUBE_ELEMENT_TIMEOUT_MS = 10000; // Max time to wait for YouTube elements (milliseconds)
    const GEMINI_ELEMENT_TIMEOUT_MS = 15000; // Max time to wait for Gemini elements (milliseconds)
    const GEMINI_PROMPT_EXPIRY_MS = 300000; // 5 minutes validity for the prompt transfer

    // --- Debug Logging ---
    function debugLog(message) {
        console.log(`[YouTube to Gemini] ${message}`);
    }

    // --- Helper Functions ---
    function waitForElement(selector, timeoutMs, parent = document) {
        return new Promise((resolve, reject) => {
            let element = parent.querySelector(selector);
            if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
                return resolve(element);
            }

            const intervalId = setInterval(() => {
                element = parent.querySelector(selector);
                if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
                    clearInterval(intervalId);
                    clearTimeout(timeoutId);
                    resolve(element);
                }
            }, CHECK_INTERVAL_MS);

            const timeoutId = setTimeout(() => {
                clearInterval(intervalId);
                debugLog(`Element not found or not visible after ${timeoutMs}ms: ${selector}`);
                reject(new Error(`Element not found or not visible: ${selector}`));
            }, timeoutMs);
        });
    }

     function waitForElements(selectors, timeoutMs, parent = document) {
        return new Promise((resolve, reject) => {
            let foundElement = null;
            const startTime = Date.now();

            function checkElements() {
                for (const selector of selectors) {
                    const elements = parent.querySelectorAll(selector);
                    for (const el of elements) {
                        // Check for visibility (basic check)
                        if (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0) {
                             // Additional check for send button state if applicable
                            if (selectors.some(s => s.includes('button')) && el.disabled) {
                                continue; // Skip disabled buttons if looking for a send button
                            }
                            foundElement = el;
                            break;
                        }
                    }
                    if (foundElement) break;
                }

                if (foundElement) {
                    clearInterval(intervalId);
                    clearTimeout(timeoutId);
                    resolve(foundElement);
                } else if (Date.now() - startTime > timeoutMs) {
                    clearInterval(intervalId);
                     debugLog(`Elements not found or not visible after ${timeoutMs}ms: ${selectors.join(', ')}`);
                    reject(new Error(`Elements not found or not visible: ${selectors.join(', ')}`));
                }
            }

            const intervalId = setInterval(checkElements, CHECK_INTERVAL_MS);
            const timeoutId = setTimeout(() => {
                 clearInterval(intervalId);
                 if (!foundElement) {
                     debugLog(`Elements not found or not visible after ${timeoutMs}ms: ${selectors.join(', ')}`);
                     reject(new Error(`Elements not found or not visible: ${selectors.join(', ')}`));
                 }
             }, timeoutMs);

             // Initial check
             checkElements();
        });
    }


    function copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            debugLog('Failed to copy to clipboard using execCommand.');
            // Fallback or notification could be added here
        }
        document.body.removeChild(textarea);
    }

    function showNotification(elementId, message, styles, duration = 15000) {
         // Remove existing notification first
         let existingNotification = document.getElementById(elementId);
         if (existingNotification) {
             document.body.removeChild(existingNotification);
         }

        const notification = document.createElement('div');
        notification.id = elementId;
        notification.innerText = message;
        Object.assign(notification.style, styles); // Apply base styles

        document.body.appendChild(notification);

        // Add close button
        const closeButton = document.createElement('button');
        closeButton.innerText = '✕';
        // Basic styling, adjust as needed
        closeButton.style.position = 'absolute';
        closeButton.style.top = '5px';
        closeButton.style.right = '10px';
        closeButton.style.background = 'transparent';
        closeButton.style.border = 'none';
        closeButton.style.color = 'inherit'; // Inherit color from notification
        closeButton.style.fontSize = '16px';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = function() {
             if (document.body.contains(notification)) {
                 document.body.removeChild(notification);
             }
        };
        notification.appendChild(closeButton);

        // Auto-remove after duration
        const timeoutId = setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, duration);
         // Store timeout ID if needed for cancellation
         notification.dataset.timeoutId = timeoutId;
    }

    // --- YouTube Specific ---
    const YOUTUBE_NOTIFICATION_ID = 'gemini-yt-notification';
    const YOUTUBE_NOTIFICATION_STYLE = {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '20px',
        borderRadius: '8px',
        zIndex: '9999',
        maxWidth: '80%',
        textAlign: 'left',
        whiteSpace: 'pre-line'
    };

    function addSummarizeButton() {
        // Check if it's a watch page (adjust if URL structure is different)
        // Using the provided URL pattern from the original script for consistency
         if (!window.location.href.includes('youtube.com/watch')) {
            debugLog("Not a watch page (based on URL check), button not added.");
            return;
        }

        if (document.getElementById('gemini-summarize-btn')) {
            debugLog("Summarize button already exists.");
            return;
        }

        // Use the original selector, wait for it
        waitForElement('#masthead #end', YOUTUBE_ELEMENT_TIMEOUT_MS)
            .then(container => {
                 if (document.getElementById('gemini-summarize-btn')) return; // Double check

                const button = document.createElement('button');
                button.id = 'gemini-summarize-btn';
                button.innerText = '📝 Gemini摘要';
                // Apply original styles
                Object.assign(button.style, {
                    backgroundColor: '#2F80ED',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px 16px',
                    margin: '0 16px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    height: '36px', // Match YouTube's button height
                    display: 'flex',
                    alignItems: 'center'
                });


                button.addEventListener('click', function() {
                    const youtubeUrl = window.location.href;
                    // Attempt to get a cleaner title
                    const videoTitle = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || document.title.replace(' - YouTube', '');

                    const prompt = `请分析这个YouTube视频: ${youtubeUrl}\n\n提供一个全面的摘要，包括主要观点、关键见解和视频中讨论的重要细节，以结构化的方式分解内容，并包括任何重要的结论或要点。`;

                    GM_setValue('geminiPrompt', prompt);
                    GM_setValue('videoTitle', videoTitle);
                    GM_setValue('timestamp', Date.now());

                    // Open Gemini in a new tab
                    window.open('https://gemini.google.com/', '_blank');

                    const notificationMessage = `
已跳转到Gemini！
系统将尝试自动输入并发送提示。

如果自动操作失败，提示词已复制到剪贴板，您可以手动粘贴。

视频: "${videoTitle}"
                    `;
                    showNotification(YOUTUBE_NOTIFICATION_ID, notificationMessage.trim(), YOUTUBE_NOTIFICATION_STYLE);
                    copyToClipboard(prompt); // Backup copy
                });

                // Add the button to the container
                 container.insertBefore(button, container.firstChild);
                 debugLog("Summarize button added successfully.");

            })
            .catch(error => {
                debugLog(`Could not add YouTube button: ${error.message}`);
            });
    }

    // --- Gemini Specific ---
    const GEMINI_NOTIFICATION_ID = 'gemini-auto-notification';
    const GEMINI_NOTIFICATION_STYLES = {
        info: {
            backgroundColor: '#e8f4fd', color: '#0866c2', border: '1px solid #b8daff'
        },
        warning: {
            backgroundColor: '#fff3e0', color: '#b35d00', border: '1px solid #ffe0b2'
        },
        error: {
            backgroundColor: '#fdecea', color: '#c62828', border: '1px solid #ffcdd2'
        }
    };
    const BASE_GEMINI_NOTIFICATION_STYLE = {
         position: 'fixed', bottom: '20px', right: '20px', padding: '15px 20px',
         borderRadius: '8px', zIndex: '9999', maxWidth: '350px', textAlign: 'left',
         boxShadow: '0 4px 12px rgba(0,0,0,0.15)', whiteSpace: 'pre-line'
    };

    function showGeminiNotification(message, type = "info") {
        const style = { ...BASE_GEMINI_NOTIFICATION_STYLE, ...(GEMINI_NOTIFICATION_STYLES[type] || GEMINI_NOTIFICATION_STYLES.info) };
        showNotification(GEMINI_NOTIFICATION_ID, message, style, 10000);
    }


    async function handleGemini() {
         debugLog("Gemini page detected. Checking for prompt...");

        const prompt = GM_getValue('geminiPrompt', '');
        const timestamp = GM_getValue('timestamp', 0);
        const videoTitle = GM_getValue('videoTitle', 'N/A');

        // Check if prompt exists and is recent
        if (!prompt || Date.now() - timestamp > GEMINI_PROMPT_EXPIRY_MS) {
            debugLog("No valid prompt found in storage or it expired.");
            GM_deleteValue('geminiPrompt'); // Clean up expired/invalid prompt
            GM_deleteValue('timestamp');
            GM_deleteValue('videoTitle');
            return;
        }

        debugLog("Valid prompt found. Waiting for Gemini input area...");

        // Use the original selectors from the script
         const textareaSelectors = [
            'div[class*="text-input-field"][class*="with-toolbox-drawer"]', // Specific from screenshot
            'div[class*="input-area"]', // General area
            'div[contenteditable="true"]', // Content editable divs often used
            'div[class*="textarea-wrapper"]',
            'textarea', // Standard textarea
            'div[role="textbox"]' // Accessibility role
        ];

        try {
            // Wait for the textarea to appear and be interactable
            const textarea = await waitForElements(textareaSelectors, GEMINI_ELEMENT_TIMEOUT_MS);
            debugLog("Textarea found. Attempting to input prompt.");

            // Input the text - trying different methods for compatibility
            let inputSuccess = false;
            try {
                 textarea.focus(); // Focus first

                 if (textarea.isContentEditable) {
                     textarea.innerText = prompt; // Method 1: for contentEditable divs
                 } else if (textarea.tagName.toLowerCase() === 'textarea') {
                     textarea.value = prompt; // Method 2: for <textarea>
                 } else {
                     // Method 3: Fallback using execCommand (less reliable now)
                     document.execCommand('insertText', false, prompt);
                 }
                 // Trigger events to make sure the framework detects the change
                 textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                 textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                 inputSuccess = true;
                 debugLog("Prompt inserted into textarea.");
             } catch (inputError) {
                debugLog(`Error inserting text: ${inputError}. Trying clipboard fallback.`);
                showGeminiNotification("无法自动填入提示词。请手动粘贴。\n提示词已复制到剪贴板。", "error");
                copyToClipboard(prompt);
                 // Clean up storage as we failed
                 GM_deleteValue('geminiPrompt');
                 GM_deleteValue('timestamp');
                 GM_deleteValue('videoTitle');
                 return; // Stop further execution if input fails
             }


            if (inputSuccess) {
                 // Wait a very short moment for UI to potentially update after input
                 await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay

                 debugLog("Waiting for send button...");
                // Use the original selectors
                 const sendButtonSelectors = [
                     'button:has(mat-icon[data-mat-icon-name="send"])', // Icon inside button
                     'mat-icon[data-mat-icon-name="send"]', // The icon itself (might need parent click)
                     'button:has(span.mat-mdc-button-touch-target)', // Material components structure
                     'button.mat-mdc-icon-button', // General Material icon button
                     'button[id*="submit"]', // Buttons with 'submit' in ID
                     // Fallbacks based on aria-label (language-dependent)
                     'button[aria-label="Run"]',
                     'button[aria-label="Send"]',
                     'button[aria-label="Submit"]',
                     'button[aria-label="发送"]' // Chinese label
                 ];

                 try {
                    // Wait for the send button to appear and be clickable
                    let sendButtonElement = await waitForElements(sendButtonSelectors, GEMINI_ELEMENT_TIMEOUT_MS);
                     debugLog("Send button found.");

                    // If the found element is the icon, get the parent button
                    if (sendButtonElement.tagName.toLowerCase() === 'mat-icon') {
                         const parentButton = sendButtonElement.closest('button');
                         if (parentButton && !parentButton.disabled) {
                             sendButtonElement = parentButton;
                         } else {
                            throw new Error("Send icon found, but parent button is missing or disabled.");
                         }
                     }

                    // Check if the button is enabled
                    if (sendButtonElement.disabled) {
                         debugLog("Send button is disabled. Waiting a bit longer...");
                         // Wait a bit more, maybe it enables after input validation
                         await new Promise(resolve => setTimeout(resolve, 500));
                         if (sendButtonElement.disabled) {
                            throw new Error("Send button remained disabled.");
                         }
                     }

                    // Click the button
                    sendButtonElement.click();
                    debugLog("Send button clicked successfully.");

                    // Success notification
                     const successMessage = `
已自动发送视频摘要请求！

正在分析视频: "${videoTitle}"

请稍候，Gemini正在处理您的请求...
                    `;
                    showGeminiNotification(successMessage.trim(), "info");

                    // Clean up storage after successful operation
                    GM_deleteValue('geminiPrompt');
                    GM_deleteValue('timestamp');
                    GM_deleteValue('videoTitle');

                 } catch (buttonError) {
                    debugLog(`Send button error: ${buttonError.message}`);
                    showGeminiNotification("找不到或无法点击发送按钮。\n提示词已填入，请手动点击发送。", "warning");
                     // Keep prompt in storage for manual use if button click fails
                 }
             }

        } catch (textareaError) {
            debugLog(`Textarea error: ${textareaError.message}`);
            showGeminiNotification("无法找到Gemini输入框。\n请手动粘贴提示词。\n提示词已复制到剪贴板。", "error");
            copyToClipboard(prompt); // Ensure prompt is available
             // Clean up storage as we failed early
            GM_deleteValue('geminiPrompt');
            GM_deleteValue('timestamp');
            GM_deleteValue('videoTitle');
        }
    }

    // --- Main Execution Logic ---
    const isYouTube = window.location.hostname.includes('youtube.com') || window.location.hostname.includes('www.youtube.com'); // Added www.youtube.com just in case
    const isGemini = window.location.hostname.includes('gemini.google.com');

    if (isYouTube) {
        debugLog("YouTube page detected. Initializing button adder.");
        // Initial attempt to add the button
        addSummarizeButton();

        // Observe URL changes for SPA navigation
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                 debugLog(`URL changed to: ${currentUrl}. Re-checking for button placement.`);
                // Wait a brief moment for the new page content to potentially load
                setTimeout(addSummarizeButton, 500); // Reduced delay
            }
        });
        // Observe the body for broader changes, but consider performance if issues arise
        observer.observe(document.body, { childList: true, subtree: true });
        debugLog("MutationObserver set up for URL changes.");

    } else if (isGemini) {
        // Use window.onload or a short delay to ensure GM_getValue is ready after page load
        // document-idle should be sufficient, but adding a small safety delay.
        setTimeout(handleGemini, 500); // Start Gemini logic slightly after idle
    }

})();