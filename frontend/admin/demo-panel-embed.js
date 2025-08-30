// Demo Panel Embed Script for Cell Architecture Demo
// This script provides a floating demo panel that can be toggled on any page

(function() {
    'use strict';
    
    // Check if panel already exists
    if (document.getElementById('demo-panel-embed')) {
        return;
    }
    
    // Create demo panel HTML
    const panelHTML = `
        <div id="demo-panel-embed" style="
            position: fixed;
            top: 20px;
            right: 20px;
            width: 300px;
            background: linear-gradient(135deg, #1e1e2e 0%, #27293d 100%);
            border: 1px solid #3d4263;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: none;
            overflow: hidden;
        ">
            <div style="
                background: #2d3142;
                padding: 12px 16px;
                border-bottom: 1px solid #3d4263;
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <h3 style="color: #e0e0e0; margin: 0; font-size: 14px; font-weight: 600;">
                    Demo Script
                </h3>
                <button id="demo-panel-close" style="
                    background: none;
                    border: none;
                    color: #8b949e;
                    cursor: pointer;
                    font-size: 16px;
                    padding: 4px;
                ">×</button>
            </div>
            <div style="padding: 16px; max-height: 400px; overflow-y: auto;">
                <div style="margin-bottom: 12px;">
                    <label style="
                        display: flex;
                        align-items: center;
                        color: #e0e0e0;
                        font-size: 12px;
                        margin-bottom: 8px;
                        cursor: pointer;
                    ">
                        <input type="checkbox" id="demo-highlights-toggle" style="margin-right: 8px;">
                        Show highlights only
                    </label>
                </div>
                <div id="demo-content" style="
                    background: #1a1b26;
                    border: 1px solid #3d4263;
                    border-radius: 4px;
                    padding: 12px;
                    font-size: 12px;
                    line-height: 1.4;
                    color: #c9d1d9;
                    max-height: 300px;
                    overflow-y: auto;
                ">
                    <p><strong>AWS Cell Architecture Demo</strong></p>
                    <p>This demo showcases a resilient, scalable cell-based architecture using AWS services.</p>
                    
                    <h4 style="color: #58a6ff; margin: 16px 0 8px 0;">What is Cell Architecture?</h4>
                    <p>Cell architecture is a pattern that partitions a service into independent, isolated units called "cells." Each cell:</p>
                    <ul style="margin: 8px 0; padding-left: 20px;">
                        <li>Operates independently with its own resources</li>
                        <li>Has built-in fault isolation</li>
                        <li>Can scale independently</li>
                        <li>Reduces blast radius of failures</li>
                    </ul>
                    
                    <h4 style="color: #58a6ff; margin: 16px 0 8px 0;">Demo Components:</h4>
                    <ul style="margin: 8px 0; padding-left: 20px;">
                        <li><strong>Consistent Hashing:</strong> Routes clients to cells</li>
                        <li><strong>Health Monitoring:</strong> Tracks cell availability</li>
                        <li><strong>Auto-failover:</strong> Routes around unhealthy cells</li>
                        <li><strong>Client Tracking:</strong> Monitors usage across cells</li>
                    </ul>
                    
                    <h4 style="color: #58a6ff; margin: 16px 0 8px 0;">Try It:</h4>
                    <ol style="margin: 8px 0; padding-left: 20px;">
                        <li>Use the router to test client routing</li>
                        <li>Monitor cell health in the admin dashboard</li>
                        <li>Observe client distribution across cells</li>
                        <li>Test failover by disabling a cell</li>
                    </ol>
                </div>
                <div style="margin-top: 12px;">
                    <a href="/demo-script.html" target="_blank" style="
                        color: #58a6ff;
                        text-decoration: none;
                        font-size: 12px;
                        display: inline-block;
                        padding: 6px 12px;
                        background: rgba(88, 166, 255, 0.1);
                        border: 1px solid #58a6ff;
                        border-radius: 4px;
                        transition: background 0.2s;
                    ">View Full Script</a>
                </div>
            </div>
        </div>
    `;
    
    // Create toggle button
    const toggleHTML = `
        <button id="demo-panel-toggle" style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, #58a6ff 0%, #4285f4 100%);
            border: none;
            border-radius: 25px;
            color: white;
            font-size: 18px;
            cursor: pointer;
            z-index: 9999;
            box-shadow: 0 2px 10px rgba(88, 166, 255, 0.3);
            transition: transform 0.2s, box-shadow 0.2s;
        " title="Toggle Demo Script">
            ?
        </button>
    `;
    
    // Add CSS for hover effects
    const style = document.createElement('style');
    style.textContent = `
        #demo-panel-toggle:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 20px rgba(88, 166, 255, 0.4);
        }
        #demo-panel-close:hover {
            color: #e0e0e0;
        }
    `;
    document.head.appendChild(style);
    
    // Add elements to page
    document.body.insertAdjacentHTML('beforeend', panelHTML);
    document.body.insertAdjacentHTML('beforeend', toggleHTML);
    
    // Add event listeners
    const panel = document.getElementById('demo-panel-embed');
    const toggle = document.getElementById('demo-panel-toggle');
    const close = document.getElementById('demo-panel-close');
    const highlightsToggle = document.getElementById('demo-highlights-toggle');
    
    toggle.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    
    close.addEventListener('click', () => {
        panel.style.display = 'none';
    });
    
    // Handle highlights toggle (simplified for embed)
    highlightsToggle.addEventListener('change', (e) => {
        const content = document.getElementById('demo-content');
        if (e.target.checked) {
            content.innerHTML = `
                <p><strong>Key Highlights:</strong></p>
                <ul style="margin: 8px 0; padding-left: 20px;">
                    <li><span style="color: #58a6ff;">Cell Architecture:</span> Independent, isolated service units</li>
                    <li><span style="color: #58a6ff;">Consistent Hashing:</span> Distributes load evenly across cells</li>
                    <li><span style="color: #58a6ff;">Health Monitoring:</span> Real-time cell status tracking</li>
                    <li><span style="color: #58a6ff;">Auto-failover:</span> Automatic routing around failures</li>
                    <li><span style="color: #58a6ff;">Client Tracking:</span> Monitor usage patterns</li>
                </ul>
            `;
        } else {
            // Restore full content
            content.innerHTML = `
                <p><strong>AWS Cell Architecture Demo</strong></p>
                <p>This demo showcases a resilient, scalable cell-based architecture using AWS services.</p>
                
                <h4 style="color: #58a6ff; margin: 16px 0 8px 0;">What is Cell Architecture?</h4>
                <p>Cell architecture is a pattern that partitions a service into independent, isolated units called "cells." Each cell:</p>
                <ul style="margin: 8px 0; padding-left: 20px;">
                    <li>Operates independently with its own resources</li>
                    <li>Has built-in fault isolation</li>
                    <li>Can scale independently</li>
                    <li>Reduces blast radius of failures</li>
                </ul>
                
                <h4 style="color: #58a6ff; margin: 16px 0 8px 0;">Demo Components:</h4>
                <ul style="margin: 8px 0; padding-left: 20px;">
                    <li><strong>Consistent Hashing:</strong> Routes clients to cells</li>
                    <li><strong>Health Monitoring:</strong> Tracks cell availability</li>
                    <li><strong>Auto-failover:</strong> Routes around unhealthy cells</li>
                    <li><strong>Client Tracking:</strong> Monitors usage across cells</li>
                </ul>
                
                <h4 style="color: #58a6ff; margin: 16px 0 8px 0;">Try It:</h4>
                <ol style="margin: 8px 0; padding-left: 20px;">
                    <li>Use the router to test client routing</li>
                    <li>Monitor cell health in the admin dashboard</li>
                    <li>Observe client distribution across cells</li>
                    <li>Test failover by disabling a cell</li>
                </ol>
            `;
        }
    });
    
    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (panel.style.display === 'block' && 
            !panel.contains(e.target) && 
            !toggle.contains(e.target)) {
            panel.style.display = 'none';
        }
    });
    
    console.log('Demo panel embed loaded successfully');
})();