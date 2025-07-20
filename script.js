        const statusEl = document.getElementById('connection-status');
        const trackTimerEl = document.getElementById('track-timer');
        const trackInfoEl = document.getElementById('track-info');
        const serverMessageEl = document.getElementById('server-message');
        const serverTimeEl = document.getElementById('server-time');
        //const localTimeEl = document.getElementById('local-time');
        const eventsTableBody = document.getElementById('events-table-body');
        const eventsCountEl = document.getElementById('events-count');
        const eventsTagEl = document.getElementById('events-tag');
        //const lastSyncEl = document.getElementById('last-sync');
        const syncStatusEl = document.getElementById('sync-status');
        
        // State variables
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 10;
        const reconnectDelay = 3000;
        let countdownInterval = null;
        let currentCountdownEndTime = 0;
        let ws = null;
        let currentHost = '';
        let lastSyncTime = null;
        let serverTimeInterval = null;
        let localTimeInterval = null;
        let timeSinceLastSync = 0;

        // NEW: Track the displayed server time and resync state
        let displayedServerTime = null;
    
        
        // Default hosts
        const instances = {
            'radioscorpio.be': 'zaracloud.radioscorpio.be',
            'kaboutersoft.be': 'zaracloud.kaboutersoft.be'
        };

        // Initialize when page loads
        window.addEventListener('DOMContentLoaded', () => {
            initFromURL();
                
        });

        
            
        


        class TimeSynchronizer {
            constructor(updateCallback) {
                this.serverBase = null;      // Last valid server timestamp
                this.localBase = null;       // Local time when last valid message was processed
                this.avgLatency = null;      // Moving average of network latency
                this.lastValidTime = null;   // Local time of last valid message
                this.updateCallback = updateCallback; // Callback to update displayed time
                this.timer = null;
                
                // Configuration
                this.THRESHOLD = 500;       // Max allowed latency deviation (ms)
                this.ALPHA = 0.2;           // Smoothing factor for latency average
                this.ACCEPT_TIMEOUT = 3000; // Force sync after this inactivity (ms)
                this.UPDATE_INTERVAL = 1000; // UI update interval (ms)
            }

            // Handle incoming server time updates
            handleServerTime(stamp) {
                const now = Date.now();
                console.log("Handling server time:", stamp, "at local time:", now);

                // Initialize on first message
                if (this.serverBase === null) {
                    this.initializeTime(stamp, now);
                    return;
                }

                // Calculate current message latency
                const currentLatency = now - stamp;
                const latencyDiff = Math.abs(currentLatency - (this.avgLatency ?? currentLatency));

                console.log(`Current latency: ${currentLatency}ms, Avg latency: ${this.avgLatency}ms, Latency diff: ${latencyDiff}ms`);

                // Check if we need to force acceptance
                const timeSinceValid = now - this.lastValidTime;
                if (timeSinceValid > this.ACCEPT_TIMEOUT) {
                    this.initializeTime(stamp, now);
                    console.log("Forced synchronization due to timeout");
                    return;
                }

                // Accept message if within latency threshold
                if (latencyDiff <= this.THRESHOLD) {
                    this.updateTime(stamp, now, currentLatency);
                } else {
                    console.log(`Ignoring delayed message. Latency diff: ${latencyDiff}ms`);
                }
            }

            // Initialize time bases
            initializeTime(stamp, now) {
                this.serverBase = stamp;
                this.localBase = now;
                this.avgLatency = now - stamp;
                this.lastValidTime = now;
                this.startTimer();
            }

            // Update time with new valid message
            updateTime(stamp, now, currentLatency) {
                // Update latency average (moving average)
                this.avgLatency = this.ALPHA * currentLatency + 
                                (1 - this.ALPHA) * (this.avgLatency ?? currentLatency);
                
                this.serverBase = stamp;
                this.localBase = now;
                this.lastValidTime = now;
            }

            // Start the local timer
            startTimer() {
                if (this.timer) clearInterval(this.timer);
                
                this.timer = setInterval(() => {
                    if (this.serverBase === null) return;
                    
                    const elapsed = Date.now() - this.localBase;
                    const currentServerTime = this.serverBase + elapsed;
                    
                    // Update display via callback
                    this.updateCallback(currentServerTime);
                }, this.UPDATE_INTERVAL);
            }

            // Clean up
            stop() {
                clearInterval(this.timer);
            }
        }



        // Display function
        function displayTime(timestamp) {
            const date = new Date(timestamp);
            serverTimeEl.textContent = date.toLocaleString().replace(',',' - '); // HH:MM:SS
        }


        const timeSync = new TimeSynchronizer(displayTime);

    



        // Initialize from URL parameters
        function initFromURL() {
            const urlParams = new URLSearchParams(window.location.search);
            const instanceParam = urlParams.get('instance');
            const customHost = urlParams.get('host');
            
            if (instanceParam === 'custom' && customHost) {
                connectToInstance('custom', customHost);
            } else if (instanceParam && instances[instanceParam]) {
                connectToInstance(instanceParam, instances[instanceParam]);
            } else {
                connectToInstance('radioscorpio.be', instances['radioscorpio.be']);
            }
        }

        // Connect to a specific instance
        function connectToInstance(instanceKey, host) {
            // Close existing connection if any
            if (ws && ws.readyState !== WebSocket.CLOSED) {
                ws.close();
            }
            
            // Reset state
            reconnectAttempts = 0;
            currentHost = host;
            
            // Update status
            statusEl.textContent = `Connecting to ${host}...`;
            statusEl.className = 'connecting';
            trackInfoEl.textContent = 'No track playing';
            trackTimerEl.textContent = '--:--';
            serverMessageEl.textContent = 'Waiting for connection...';
            syncStatusEl.textContent = 'Connecting...';
            syncStatusEl.className = 'sync-warning';
            
            // Clear any existing interval
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            
            // Clear events table
            eventsTableBody.innerHTML = '<tr><td colspan="5" class="no-events">Waiting for event data...</td></tr>';
            eventsCountEl.textContent = 'Showing 0 events';
            eventsTagEl.textContent = '';
            
            // Connect to WebSocket
            connectWebSocket(host);
        }



        // Format seconds to MM:SS
        function formatTime(seconds) {
            const mins = Math.floor(Math.abs(seconds) / 60);
            const secs = Math.floor(Math.abs(seconds) % 60);
            const sign = seconds < 0 ? '-' : '';
            return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        // Format ISO timestamp to DD/MM/YYYY, HH:MM:SS
        function formatISOTime(isoString) {
            const date = new Date(isoString);
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            
            return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
        }


        // Calculate and update the remaining time
        function updateTimerDisplay() {
            const now = Date.now();
            const remainingSeconds = (currentCountdownEndTime - now) / 1000;
            
            if (currentCountdownEndTime > 0) {
                trackTimerEl.textContent = formatTime(remainingSeconds);
                
                if (remainingSeconds <= 0) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                    trackTimerEl.textContent = '00:00';
                    trackInfoEl.textContent = 'Track finished';
                }
            }
        }

        // Start or update the countdown timer
        function updateCountdown(data) {
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            
            const filename = data.track.split('/').pop() || 'Unknown Track';
            trackInfoEl.textContent = `${filename}`;
            
            const now = Date.now();
            
            if (data.status === 'start') {
                currentCountdownEndTime = now + (data.file_duration * 1000);
            } else if (data.status === 'playing') {
                currentCountdownEndTime = now + (data.remaining_time * 1000);
            }
            
            updateTimerDisplay();
            countdownInterval = setInterval(updateTimerDisplay, 100);
        }

        // Format JSON for nice console output
        function formatForConsole(data) {
            //console.groupCollapsed('WebSocket Message Received');
            //console.log('Timestamp:', new Date().toISOString());
            //console.log('Status:', data.status || 'Unknown');
            //console.log('Full Data:', data);
            //console.groupEnd();
            
            // Alternative formatted output
            console.log('%cWebSocket Data:', 'color: #4CAF50; font-weight: bold', 
                JSON.stringify(data, null, 2));
        }

        // Update events table with new data
        function updateEvents(data) {
            if (data.status === "event_status" && data.events) {
                const events = data.events;
                
                // Update metadata
                eventsCountEl.textContent = `Showing ${events.length} of ${data.event_meta.size} events`;
                eventsTagEl.textContent = data.event_meta.tag;
                
                // Clear existing rows
                eventsTableBody.innerHTML = '';
                
                if (events.length === 0) {
                    eventsTableBody.innerHTML = '<tr><td colspan="5" class="no-events">No upcoming events</td></tr>';
                    return;
                }
                
                // Add each event to the table
                events.forEach(event => {
                    const eventData = event.event;
                    const row = document.createElement('tr');
                    
                    // Format event time
                    const formattedTime = event.timestamp_iso.replace('T', ' - ');
                    
                    // Shorten file path for display
                    const formattedPath = eventData.fichero ? eventData.fichero.replace(/\\\\/g, '\\') : '';
                    
                    row.innerHTML = `
                        <td class="event-time">${formattedTime}</td>
                        <td class="event-file" title="${formattedPath}">${formattedPath}</td>
                    `;
                    
                    eventsTableBody.appendChild(row);
                });
            }
        }

        // WebSocket connection management
        function connectWebSocket(host) {
            const wsUrl = `wss://${host}/ws`;
            
            ws = new WebSocket(wsUrl);

    

            ws.onopen = () => {
                statusEl.textContent = `Connected to ${host}`;
                statusEl.className = 'connected';
                serverMessageEl.textContent = 'Waiting for first update...';
                reconnectAttempts = 0;
                syncStatusEl.textContent = 'Syncing time...';
                syncStatusEl.className = 'sync-warning';
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    formatForConsole(data); // Log to console
                    updateUI(data);
                    
                    if (data.status === 'start' || data.status === 'playing') {
                        updateCountdown(data);
                    }
                    
                    // Update events if event_status is received
                    if (data.status === "event_status") {
                        updateEvents(data);
                    }
                    
                    // Update sync status
                    lastSyncTime = Date.now();
                    //lastSyncEl.textContent = formatISOTime(new Date().toISOString());
                } catch (e) {
                    console.error('Error parsing WebSocket message:', e);
                }
            };

            ws.onclose = (event) => {
                statusEl.textContent = `Disconnected from ${host}`;
                statusEl.className = 'disconnected';
                syncStatusEl.textContent = 'Disconnected';
                syncStatusEl.className = 'sync-bad';

                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    serverMessageEl.textContent = `Reconnecting in ${reconnectDelay/1000} seconds (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`;
                    setTimeout(() => connectWebSocket(host), reconnectDelay);
                } else {
                    serverMessageEl.textContent = 'Connection failed. Please try another instance.';
                }
                
                if (countdownInterval) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                }
                trackTimerEl.textContent = '--:-- (disconnected)';
            };

            ws.onerror = (error) => {
                statusEl.textContent = `Error connecting to ${host}`;
                statusEl.className = 'disconnected';
                syncStatusEl.textContent = 'Connection error';
                syncStatusEl.className = 'sync-bad';
            };
        }



    
        function updateUI(data) {

             // Update server message
            if (data.messages) {
                serverMessageEl.textContent = data.messages;
            }

            // Update server time with real data
            if (data.iso) {
                const serverTime = new Date(data.utc * 1000).getTime();
                timeSync.handleServerTime(serverTime);
                return;
            }
        }