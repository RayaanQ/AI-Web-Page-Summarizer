//Content Script file that runs on all web pages to provide content extraction capabilities. Enhanced content extraction utility and Provides better content detection and cleaning

// Enhanced Content Script for Better Q&A Support
// Provides improved content extraction and analysis capabilities

(function() {
    'use strict';
    
    class EnhancedContentExtractor {
        constructor() {
            this.readabilitySelectors = [
                'article', 'main', '[role="main"]', '.post-content', '.entry-content', 
                '.article-content', '.content-body', '.story-content', '.post-body',
                '.article-body', '.story-body', '.entry-body', '.content-wrapper',
                '.post-container', '.blog-content', '.entry-wrapper'
            ];
            
            this.excludeSelectors = [
                'script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'button',
                '.advertisement', '.ads', '.ad-container', '.sidebar', '.navigation',
                '.menu', '.comments', '.comment-section', '.social-share', '.related-posts',
                '.author-bio', '.newsletter-signup', '[role="navigation"]', '[role="banner"]',
                '[role="contentinfo"]', '[role="complementary"]'
            ];
        }
        
        // Extract structured content for better Q&A
        extractStructuredContent() {
            const content = this.extractPageContent();
            
            // Extract additional structured data for Q&A
            const structuredData = {
                ...content,
                headings: this.extractHeadings(),
                links: this.extractImportantLinks(),
                lists: this.extractLists(),
                tables: this.extractTables(),
                codeBlocks: this.extractCodeBlocks(),
                quotes: this.extractQuotes()
            };
            
            return structuredData;
        }
        
        // Extract headings for topic structure
        extractHeadings() {
            const headings = [];
            const headingElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
            
            headingElements.forEach(heading => {
                const text = heading.textContent.trim();
                if (text && text.length > 3 && text.length < 200) {
                    headings.push({
                        level: parseInt(heading.tagName.substring(1)),
                        text: text,
                        id: heading.id || null
                    });
                }
            });
            
            return headings;
        }
        
        // Extract important links (not navigation)
        extractImportantLinks() {
            const links = [];
            const linkElements = document.querySelectorAll('a[href]');
            
            linkElements.forEach(link => {
                const href = link.getAttribute('href');
                const text = link.textContent.trim();
                
                // Filter out navigation and unimportant links
                if (href && text && 
                    text.length > 5 && text.length < 100 &&
                    !href.startsWith('#') &&
                    !this.isNavigationLink(link)) {
                    
                    links.push({
                        url: href,
                        text: text,
                        title: link.getAttribute('title') || null
                    });
                }
            });
            
            return links.slice(0, 20); // Limit to most important links
        }
        
        // Check if link is likely navigation
        isNavigationLink(link) {
            const navKeywords = ['menu', 'nav', 'header', 'footer', 'sidebar'];
            const parent = link.closest(navKeywords.map(k => `.${k}, [role="${k}"], ${k}`).join(', '));
            return !!parent;
        }
        
        // Extract lists for structured information
        extractLists() {
            const lists = [];
            const listElements = document.querySelectorAll('ul, ol');
            
            listElements.forEach(list => {
                const items = Array.from(list.children).map(li => {
                    const text = li.textContent.trim();
                    return text.length > 10 && text.length < 500 ? text : null;
                }).filter(item => item !== null);
                
                if (items.length > 1 && items.length < 20) {
                    lists.push({
                        type: list.tagName.toLowerCase(),
                        items: items
                    });
                }
            });
            
            return lists;
        }
        
        // Extract tables for data analysis
        extractTables() {
            const tables = [];
            const tableElements = document.querySelectorAll('table');
            
            tableElements.forEach(table => {
                const rows = Array.from(table.querySelectorAll('tr'));
                if (rows.length > 1 && rows.length < 50) {
                    const tableData = {
                        headers: [],
                        rows: []
                    };
                    
                    // Get headers
                    const headerRow = table.querySelector('thead tr, tr:first-child');
                    if (headerRow) {
                        tableData.headers = Array.from(headerRow.querySelectorAll('th, td'))
                            .map(cell => cell.textContent.trim());
                    }
                    
                    // Get data rows
                    const dataRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
                    Array.from(dataRows).forEach(row => {
                        const cells = Array.from(row.querySelectorAll('td, th'))
                            .map(cell => cell.textContent.trim());
                        if (cells.some(cell => cell.length > 0)) {
                            tableData.rows.push(cells);
                        }
                    });
                    
                    if (tableData.rows.length > 0) {
                        tables.push(tableData);
                    }
                }
            });
            
            return tables;
        }
        
        // Extract code blocks for technical content
        extractCodeBlocks() {
            const codeBlocks = [];
            const codeElements = document.querySelectorAll('pre, code');
            
            codeElements.forEach(code => {
                const text = code.textContent.trim();
                if (text.length > 20 && text.length < 2000) {
                    codeBlocks.push({
                        language: code.className.match(/language-(\w+)/)?.[1] || null,
                        code: text
                    });
                }
            });
            
            return codeBlocks;
        }
        
        // Extract quotes and important callouts
        extractQuotes() {
            const quotes = [];
            const quoteElements = document.querySelectorAll('blockquote, .quote, .callout, .highlight');
            
            quoteElements.forEach(quote => {
                const text = quote.textContent.trim();
                if (text.length > 20 && text.length < 1000) {
                    quotes.push(text);
                }
            });
            
            return quotes;
        }
        
        // Main content extraction (enhanced from original)
        extractPageContent() {
            const contentElement = this.findBestContentElement();
            const content = this.extractTextFromElement(contentElement);
            
            const title = document.title || 'Untitled Page';
            const url = window.location.href;
            
            const metaDescription = document.querySelector('meta[name="description"]');
            const description = metaDescription ? metaDescription.getAttribute('content') : '';
            
            const ogTitle = document.querySelector('meta[property="og:title"]');
            const ogDescription = document.querySelector('meta[property="og:description"]');
            
            const articleAuthor = document.querySelector('meta[name="author"]') || 
                                document.querySelector('[rel="author"]') ||
                                document.querySelector('.author');
            
            const publishDate = document.querySelector('meta[property="article:published_time"]') ||
                              document.querySelector('time[datetime]') ||
                              document.querySelector('.date');
            
            return {
                title: ogTitle ? ogTitle.getAttribute('content') : title,
                url,
                content,
                description: ogDescription ? ogDescription.getAttribute('content') : description,
                author: articleAuthor ? (articleAuthor.textContent || articleAuthor.getAttribute('content')) : null,
                publishDate: publishDate ? (publishDate.getAttribute('datetime') || publishDate.textContent) : null,
                wordCount: content.split(/\s+/).filter(word => word.length > 0).length,
                characterCount: content.length,
                domain: window.location.hostname,
                timestamp: new Date().toISOString(),
                language: document.documentElement.lang || 'en'
            };
        }
        
        // Helper methods from original implementation
        extractTextFromElement(element) {
            if (!element) return '';
            
            const clone = element.cloneNode(true);
            this.excludeSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => el.remove());
            });
            
            let text = clone.innerText || clone.textContent || '';
            text = text
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n\n')
                .replace(/\t/g, ' ')
                .trim();
            
            return text;
        }
        
        findBestContentElement() {
            const candidates = [];
            
            for (const selector of this.readabilitySelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    const score = this.calculateContentScore(element);
                    if (score > 0) {
                        candidates.push({ element, score });
                    }
                });
            }
            
            if (candidates.length === 0) {
                const fallbackSelectors = ['div', 'section', 'main'];
                fallbackSelectors.forEach(tagName => {
                    const elements = document.querySelectorAll(tagName);
                    elements.forEach(element => {
                        const score = this.calculateContentScore(element);
                        if (score > 500) {
                            candidates.push({ element, score });
                        }
                    });
                });
            }
            
            if (candidates.length > 0) {
                candidates.sort((a, b) => b.score - a.score);
                return candidates[0].element;
            }
            
            return document.body;
        }
        
        calculateContentScore(element) {
            if (!element) return 0;
            
            const text = this.extractTextFromElement(element);
            const textLength = text.length;
            
            if (textLength < 100) return 0;
            
            let score = textLength;
            
            const tagName = element.tagName.toLowerCase();
            const semanticBonus = {
                'article': 200,
                'main': 150,
                'section': 100
            };
            
            if (semanticBonus[tagName]) {
                score += semanticBonus[tagName];
            }
            
            const classList = element.className.toLowerCase();
            const id = element.id.toLowerCase();
            const contentKeywords = ['content', 'article', 'post', 'story', 'entry', 'body', 'text'];
            
            contentKeywords.forEach(keyword => {
                if (classList.includes(keyword) || id.includes(keyword)) {
                    score += 100;
                }
            });
            
            const negativeKeywords = ['sidebar', 'navigation', 'menu', 'ad', 'comment', 'footer', 'header'];
            negativeKeywords.forEach(keyword => {
                if (classList.includes(keyword) || id.includes(keyword)) {
                    score -= 200;
                }
            });
            
            const links = element.querySelectorAll('a');
            const linkRatio = links.length / (text.split(' ').length || 1);
            if (linkRatio > 0.1) {
                score -= linkRatio * 500;
            }
            
            return Math.max(0, score);
        }
    }
    
    // Create enhanced global instance
    window.aiWebSummarizerExtractor = new EnhancedContentExtractor();
    
    // Listen for messages from popup with enhanced response
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'extractContent') {
            try {
                const pageData = window.aiWebSummarizerExtractor.extractPageContent();
                sendResponse({ success: true, data: pageData });
            } catch (error) {
                console.error('Content extraction error:', error);
                sendResponse({ success: false, error: error.message });
            }
        } else if (request.action === 'extractStructuredContent') {
            try {
                const structuredData = window.aiWebSummarizerExtractor.extractStructuredContent();
                sendResponse({ success: true, data: structuredData });
            } catch (error) {
                console.error('Structured content extraction error:', error);
                sendResponse({ success: false, error: error.message });
            }
        }
        return true;
    });
    
    // Signal readiness
    chrome.runtime.sendMessage({ 
        action: 'contentScriptReady',
        url: window.location.href 
    }).catch(() => {
        // Ignore errors if background script isn't ready
    });
    
})();