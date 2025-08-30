// Demo Panel Embed Script
// Add this script to any page to include the demo panel

(function() {
    // Check if panel already exists
    if (document.getElementById('demoPanel')) return;

    // Create the demo panel HTML
    const panelHTML = `
    <div class="demo-panel" id="demoPanel" style="
        position: fixed;
        top: 0;
        right: -400px;
        width: 400px;
        height: 100vh;
        background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
        box-shadow: -5px 0 20px rgba(0, 0, 0, 0.3);
        transition: right 0.3s ease-in-out;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    ">
        <div class="pull-tab" onclick="toggleDemoPanel()" style="
            position: absolute;
            left: -50px;
            top: 50%;
            transform: translateY(-50%);
            width: 50px;
            height: 120px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 10px 0 0 10px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-shadow: -3px 0 10px rgba(0, 0, 0, 0.2);
            transition: all 0.2s ease;
        ">
            <span style="
                color: white;
                font-size: 1.2rem;
                font-weight: bold;
                writing-mode: vertical-rl;
                text-orientation: mixed;
                letter-spacing: 2px;
            ">DEMO</span>
        </div>
        
        <div style="padding: 20px; height: 100%; overflow-y: auto; color: white;">
            <div style="text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid rgba(255, 255, 255, 0.2);">
                <h1 style="font-size: 1.4rem; font-weight: bold; margin: 0; color: #667eea;">🌐 Demo Script</h1>
                <p style="font-size: 0.9rem; opacity: 0.8; margin: 5px 0 0 0;">Cell Architecture Guide</p>
            </div>

            <div style="background: rgba(0, 0, 0, 0.3); padding: 10px; text-align: center; border-radius: 6px; margin-bottom: 15px;">
                <div id="demoTimer" style="font-size: 1.2rem; font-weight: bold; color: #43e97b;">00:00</div>
                <div style="margin-top: 8px;">
                    <button onclick="startDemoTimer()" style="background: rgba(255, 255, 255, 0.2); color: white; border: none; padding: 5px 10px; border-radius: 15px; cursor: pointer; margin: 0 3px; font-size: 0.8rem;">Start</button>
                    <button onclick="resetDemoTimer()" style="background: rgba(255, 255, 255, 0.2); color: white; border: none; padding: 5px 10px; border-radius: 15px; cursor: pointer; margin: 0 3px; font-size: 0.8rem;">Reset</button>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h3 style="color: #43e97b; margin-bottom: 10px;">🚀 Demo Flow (20 min)</h3>
                <div style="font-size: 0.9rem; line-height: 1.4;">
                    <div style="margin: 8px 0; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 6px;">
                        <strong>1. Introduction (3 min)</strong><br>
                        → Cell architecture overview<br>
                        → "Netflix & Amazon use this..."
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 6px;">
                        <strong>2. Routing Demo (4 min)</strong><br>
                        → Test: user123, customer456<br>
                        → Show consistency
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 6px;">
                        <strong>3. Visual Identity (5 min)</strong><br>
                        → Color themes & health<br>
                        → Recent visitors
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 6px;">
                        <strong>4. Admin Dashboard (4 min)</strong><br>
                        → Global view & controls
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 6px;">
                        <strong>5. Fault Tolerance (3 min)</strong><br>
                        → Failure isolation demo
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 6px;">
                        <strong>6. Wrap-up (1 min)</strong><br>
                        → Q&A and next steps
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <h3 style="color: #43e97b; margin-bottom: 10px;">📱 Quick URLs</h3>
                <div style="background: rgba(0, 0, 0, 0.2); padding: 10px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 0.8rem;">
                    <div style="margin: 5px 0; display: flex; justify-content: space-between;">
                        <span>Router:</span>
                        <a href="https://celladmin.sb.seibtribe.us/router.html" target="_blank" style="color: #43e97b; text-decoration: none;">Open</a>
                    </div>
                    <div style="margin: 5px 0; display: flex; justify-content: space-between;">
                        <span>Admin:</span>
                        <a href="https://celladmin.sb.seibtribe.us" target="_blank" style="color: #43e97b; text-decoration: none;">Open</a>
                    </div>
                    <div style="margin: 5px 0; display: flex; justify-content: space-between;">
                        <span>Cell 1:</span>
                        <a href="https://cell-us-east-1-az1.sb.seibtribe.us" target="_blank" style="color: #43e97b; text-decoration: none;">Open</a>
                    </div>
                    <div style="margin: 5px 0; display: flex; justify-content: space-between;">
                        <span>Cell 2:</span>
                        <a href="https://cell-us-east-1-az2.sb.seibtribe.us" target="_blank" style="color: #43e97b; text-decoration: none;">Open</a>
                    </div>
                </div>
            </div>

            <div>
                <h3 style="color: #43e97b; margin-bottom: 10px;">🎪 Key Talking Points</h3>
                <div style="font-size: 0.9rem; line-height: 1.4;">
                    <div style="margin: 8px 0; padding-left: 15px; position: relative;">
                        <span style="position: absolute; left: 0; color: #43e97b;">•</span>
                        Consistent hashing ensures predictable routing
                    </div>
                    <div style="margin: 8px 0; padding-left: 15px; position: relative;">
                        <span style="position: absolute; left: 0; color: #43e97b;">•</span>
                        Cell failures only affect 20% vs 100% of traffic
                    </div>
                    <div style="margin: 8px 0; padding-left: 15px; position: relative;">
                        <span style="position: absolute; left: 0; color: #43e97b;">•</span>
                        Visual themes help ops teams identify cells
                    </div>
                    <div style="margin: 8px 0; padding-left: 15px; position: relative;">
                        <span style="position: absolute; left: 0; color: #43e97b;">•</span>
                        Scale horizontally by adding more cells
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    // Add panel to page
    document.body.insertAdjacentHTML('beforeend', panelHTML);

    // Add CSS for mobile responsiveness
    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 768px) {
            #demoPanel {
                width: 100vw !important;
                right: -100vw !important;
            }
            #demoPanel.open {
                right: 0 !important;
            }
        }
        .demo-panel.open {
            right: 0 !important;
        }
    `;
    document.head.appendChild(style);

    // Timer functionality
    let demoStartTime;
    let demoTimerInterval;

    window.startDemoTimer = function() {
        if (demoTimerInterval) clearInterval(demoTimerInterval);
        demoStartTime = Date.now();
        demoTimerInterval = setInterval(updateDemoTimer, 1000);
    };

    window.resetDemoTimer = function() {
        if (demoTimerInterval) clearInterval(demoTimerInterval);
        document.getElementById('demoTimer').textContent = '00:00';
    };

    function updateDemoTimer() {
        const elapsed = Math.floor((Date.now() - demoStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById('demoTimer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // Panel toggle functionality
    window.toggleDemoPanel = function() {
        const panel = document.getElementById('demoPanel');
        panel.classList.toggle('open');
    };

    // Auto-show panel after 2 seconds for demo
    setTimeout(() => {
        document.getElementById('demoPanel').classList.add('open');
    }, 2000);
})();