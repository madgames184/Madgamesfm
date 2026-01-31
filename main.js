'use strict';

async function api(path) {
    const url = `${CFG.API}/station/${CFG.STATION}${path}`;
    console.log('API call:', url);
    
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), CFG.TIMEOUT);
    
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            cache: 'no-cache',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        clearTimeout(tid);
        
        console.log(`API ${path} status:`, res.status);
        
        if (!res.ok) {
            console.warn(`API ${path} failed: ${res.status}`);
            return null;
        }
        
        const data = await res.json();
        console.log(`API ${path} data:`, data);
        return data;
    } catch (e) {
        clearTimeout(tid);
        if (e.name !== 'AbortError') {
            console.error(`API ${path} error:`, e.message);
        } else {
            console.warn(`API ${path} timeout`);
        }
        return null;
    }
}

async function updateSong() {
    try {
        const song = await api('/current_song');
        console.log('Song API response:', song);
        
        if (!song) {
            $('trackTitle').textContent = 'Keine Daten';
            $('trackArtist').textContent = 'Stream läuft';
            return;
        }
        
        const title = song.title || 'Unbekannt';
        const artist = song.artist?.name || 'Unbekannt';
        
        $('trackTitle').textContent = title;
        $('trackArtist').textContent = artist;
        
        const coverEl = $('coverArt');
        if (coverEl) {
            if (song.artist && song.artist.image) {
                coverEl.innerHTML = `<img src="${song.artist.image}" alt="${artist}" onerror="this.parentElement.innerHTML='<div class=\\'cover-placeholder\\'>🎵</div>'">`;
            } else {
                coverEl.innerHTML = '<div class="cover-placeholder">🎵</div>';
            }
        }
        
        if (song.started_at) {
            try {
                const time = new Date(song.started_at);
                if (!isNaN(time.getTime())) {
                    $('trackTime').textContent = time.toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            } catch (e) {}
        }
        
        if (song.id && song.id !== state.lastSongId) {
            state.lastSongId = song.id;
            state.stats.songs++;
            saveStats();
            updateStats();
            updateFavBtn();
            
            if (state.notifications && 'Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification('🎵 ' + title, {
                        body: artist,
                        icon: song.artist?.image || '',
                        tag: 'song'
                    });
                } catch (e) {}
            }
        } else {
            updateFavBtn();
        }
    } catch (e) {
        console.error('Song update error:', e);
    }
}

async function updateListeners() {
    try {
        const data = await api('/listeners');
        console.log('Listeners API response:', data);
        
        if (data) {
            const el = $('listeners');
            if (el) {
                if (typeof data.listeners === 'number') {
                    el.textContent = `${data.listeners} Live`;
                    console.log('Updated listeners to:', data.listeners);
                } else if (typeof data.current === 'number') {
                    el.textContent = `${data.current} Live`;
                    console.log('Updated listeners (current) to:', data.current);
                } else {
                    console.warn('Unexpected listeners data format:', data);
                    el.textContent = '? Live';
                }
            }
        } else {
            console.warn('No listeners data received');
        }
    } catch (e) {
        console.error('Listeners error:', e);
    }
}

async function updateHistory() {
    try {
        const songs = await api('/last_songs');
        const histEl = $('historyList');
        if (!histEl) return;
        
        if (!songs || !Array.isArray(songs) || songs.length === 0) {
            histEl.innerHTML = '<div class="empty">Keine Daten</div>';
            return;
        }
        
        const html = songs.slice(0, CFG.MAX_HISTORY).map(s => {
            try {
                const time = new Date(s.started_at);
                const timeStr = !isNaN(time.getTime()) 
                    ? time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                    : '--:--';
                const title = (s.title || 'Unbekannt').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const artist = (s.artist?.name || 'Unbekannt').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                
                return `
                    <div class="history-item">
                        <span class="hi-time">${timeStr}</span>
                        <span class="hi-info">${artist} - ${title}</span>
                    </div>
                `;
            } catch (e) {
                return '';
            }
        }).filter(h => h).join('');
        
        histEl.innerHTML = html || '<div class="empty">Keine Daten</div>';
    } catch (e) {
        console.error('History error:', e);
        const histEl = $('historyList');
        if (histEl) {
            histEl.innerHTML = '<div class="empty">Fehler beim Laden</div>';
        }
    }
}

async function updateAll() {
    try {
        await Promise.all([
            updateSong(),
            updateListeners(),
            updateHistory()
        ]);
    } catch (e) {
        console.error('Update error:', e);
    }
}

async function togglePlay() {
    if (state.playing) {
        stopPlay();
    } else {
        await startPlay();
    }
}

async function startPlay() {
    try {
        if (state.audio) {
            try {
                state.audio.pause();
                state.audio.removeEventListener('playing', state.audio._onplaying);
                state.audio.removeEventListener('pause', state.audio._onpause);
                state.audio.removeEventListener('error', state.audio._onerror);
                state.audio.removeEventListener('waiting', state.audio._onwaiting);
            } catch (e) {}
            state.audio.src = '';
            state.audio = null;
        }
        
        $('statusText').textContent = 'Lädt...';
        $('playBtn').disabled = true;
        
        state.audio = new Audio(CFG.STREAM);
        state.audio.volume = state.muted ? 0 : state.volume;
        
        const onPlaying = () => {
            state.playing = true;
            state.reconnectAttempts = 0;
            $('playIcon').textContent = '⏸';
            $('playBtn').classList.add('playing');
            $('playBtn').disabled = false;
            $('statusText').textContent = 'Live';
            hideMsg();
            startStats();
        };
        
        const onPause = () => {
            if (state.playing) {
                state.playing = false;
                $('playIcon').textContent = '▶';
                $('playBtn').classList.remove('playing');
                $('statusText').textContent = 'Pausiert';
                stopStats();
            }
        };
        
        const onError = () => {
            console.error('Stream error');
            $('playBtn').disabled = false;
            $('statusText').textContent = 'Bereit';
            state.playing = false;
            $('playIcon').textContent = '▶';
            $('playBtn').classList.remove('playing');
            
            if (state.reconnectAttempts < 3) {
                state.reconnectAttempts++;
                showMsg(`Verbindungsfehler. Versuch ${state.reconnectAttempts}/3...`);
                setTimeout(() => {
                    console.log('Auto-retry:', state.reconnectAttempts);
                    startPlay();
                }, 2000);
            } else {
                showMsg('Klick nochmal auf Play');
            }
        };
        
        const onWaiting = () => {
            $('statusText').textContent = 'Lädt...';
        };
        
        state.audio._onplaying = onPlaying;
        state.audio._onpause = onPause;
        state.audio._onerror = onError;
        state.audio._onwaiting = onWaiting;
        
        state.audio.addEventListener('playing', onPlaying);
        state.audio.addEventListener('pause', onPause);
        state.audio.addEventListener('error', onError);
        state.audio.addEventListener('waiting', onWaiting);
        
        try {
            const playPromise = state.audio.play();
            if (playPromise) {
                await playPromise;
            }
        } catch (err) {
            $('playBtn').disabled = false;
            $('statusText').textContent = 'Bereit';
            $('playIcon').textContent = '▶';
            
            if (err.name === 'NotAllowedError') {
                showMsg('Klick nochmal auf Play');
            } else {
                showMsg('Fehler - nochmal versuchen');
            }
        }
    } catch (e) {
        console.error(e);
        $('playBtn').disabled = false;
        $('statusText').textContent = 'Bereit';
        $('playIcon').textContent = '▶';
        showMsg('Fehler - bitte neu laden');
    }
}

function stopPlay() {
    state.playing = false;
    
    if (state.audio) {
        try {
            state.audio.pause();
            state.audio.removeEventListener('playing', state.audio._onplaying);
            state.audio.removeEventListener('pause', state.audio._onpause);
            state.audio.removeEventListener('error', state.audio._onerror);
            state.audio.removeEventListener('waiting', state.audio._onwaiting);
        } catch (e) {}
        state.audio.src = '';
        state.audio = null;
    }
    
    $('playIcon').textContent = '▶';
    $('playBtn').classList.remove('playing');
    $('statusText').textContent = 'Gestoppt';
    stopStats();
}

function setVolume(val) {
    val = Math.max(0, Math.min(100, parseInt(val) || 0));
    state.volume = val / 100;
    
    const volVal = $('volVal');
    const volIcon = $('volIcon');
    
    if (volVal) volVal.textContent = val + '%';
    
    if (state.audio && !state.muted) {
        try {
            state.audio.volume = state.volume;
        } catch (e) {
            console.error('Volume set error:', e);
        }
    }
    
    if (volIcon) {
        if (val === 0) {
            state.muted = true;
            volIcon.textContent = '🔇';
        } else {
            if (state.muted) state.muted = false;
            volIcon.textContent = val < 50 ? '🔉' : '🔊';
        }
    }
    
    try {
        localStorage.setItem('volume', state.volume);
        localStorage.setItem('muted', state.muted ? 'true' : 'false');
    } catch (e) {}
}

function toggleMute() {
    state.muted = !state.muted;
    
    const volIcon = $('volIcon');
    
    if (state.audio) {
        try {
            if (state.muted) {
                state.audio.volume = 0;
                if (volIcon) volIcon.textContent = '🔇';
            } else {
                state.audio.volume = state.volume;
                const val = Math.round(state.volume * 100);
                if (volIcon) volIcon.textContent = val < 50 ? '🔉' : '🔊';
            }
        } catch (e) {
            console.error('Mute error:', e);
        }
    } else {
        if (volIcon) {
            if (state.muted) {
                volIcon.textContent = '🔇';
            } else {
                const val = Math.round(state.volume * 100);
                volIcon.textContent = val < 50 ? '🔉' : '🔊';
            }
        }
    }
    
    try {
        localStorage.setItem('muted', state.muted ? 'true' : 'false');
    } catch (e) {}
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    $('themeIcon').textContent = isLight ? '☀️' : '🌙';
    try {
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    } catch (e) {}
}

async function toggleNotif() {
    if (!('Notification' in window)) {
        showMsg('Benachrichtigungen nicht unterstützt');
        return;
    }
    
    if (state.notifications) {
        state.notifications = false;
        try {
            localStorage.setItem('notifications', 'false');
        } catch (e) {}
        $('notifIcon').textContent = '🔕';
        showMsg('Benachrichtigungen aus', true);
    } else {
        if (Notification.permission === 'denied') {
            showMsg('Benachrichtigungen blockiert');
            return;
        }
        
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                showMsg('Benachrichtigungen abgelehnt');
                return;
            }
        }
        
        state.notifications = true;
        try {
            localStorage.setItem('notifications', 'true');
        } catch (e) {}
        $('notifIcon').textContent = '🔔';
        showMsg('Benachrichtigungen an', true);
    }
}

function loadFavorites() {
    try {
        const saved = localStorage.getItem('favorites');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                state.favorites = parsed.filter(f => typeof f === 'string' && f.length > 0);
                if (state.favorites.length > CFG.MAX_FAVORITES) {
                    state.favorites = state.favorites.slice(0, CFG.MAX_FAVORITES);
                }
            } else {
                state.favorites = [];
            }
        } else {
            state.favorites = [];
        }
    } catch (e) {
        console.error('Load favorites error:', e);
        state.favorites = [];
    }
    renderFavorites();
    updateStats();
}

function saveFavorites() {
    try {
        if (Array.isArray(state.favorites)) {
            localStorage.setItem('favorites', JSON.stringify(state.favorites));
        }
    } catch (e) {
        console.error('Save favorites error:', e);
        if (e.name === 'QuotaExceededError') {
            showMsg('Speicher voll - Favoriten konnten nicht gespeichert werden');
        }
    }
}

function toggleFavorite() {
    const songEl = $('trackTitle');
    const artistEl = $('trackArtist');
    
    if (!songEl || !artistEl) {
        showMsg('Fehler');
        return;
    }
    
    const song = songEl.textContent;
    const artist = artistEl.textContent;
    
    if (!song || !artist || song === 'Bereit...' || song === 'Keine Daten' || song === 'Unbekannt') {
        showMsg('Kein Song verfügbar');
        return;
    }
    
    const key = `${artist} - ${song}`;
    const idx = state.favorites.indexOf(key);
    
    if (idx > -1) {
        state.favorites.splice(idx, 1);
        showMsg('Favorit entfernt', true);
    } else {
        if (state.favorites.length >= CFG.MAX_FAVORITES) {
            showMsg(`Max. ${CFG.MAX_FAVORITES} Favoriten`);
            return;
        }
        state.favorites.unshift(key);
        showMsg('Favorit gespeichert ❤️', true);
    }
    
    saveFavorites();
    renderFavorites();
    updateFavBtn();
    updateStats();
}

function updateFavBtn() {
    const songEl = $('trackTitle');
    const artistEl = $('trackArtist');
    const iconEl = $('favIcon');
    const textEl = $('favText');
    const btnEl = $('favBtn');
    
    if (!songEl || !artistEl || !iconEl || !textEl || !btnEl) return;
    
    const song = songEl.textContent;
    const artist = artistEl.textContent;
    const key = `${artist} - ${song}`;
    
    if (state.favorites.includes(key)) {
        iconEl.textContent = '❤️';
        textEl.textContent = 'Favorisiert';
        btnEl.classList.add('active');
    } else {
        iconEl.textContent = '🤍';
        textEl.textContent = 'Favorit';
        btnEl.classList.remove('active');
    }
}

function renderFavorites() {
    const list = $('favList');
    if (!list) return;
    
    if (!state.favorites || state.favorites.length === 0) {
        list.innerHTML = '<div class="empty">Noch keine Favoriten gespeichert</div>';
        return;
    }
    
    const html = state.favorites.map((fav, i) => {
        const safe = (fav || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
        <div class="fav-item">
            <span class="fi-text">🎵 ${safe}</span>
            <button class="fi-btn" onclick="removeFav(${i})" aria-label="Favorit entfernen">×</button>
        </div>
    `;
    }).join('');
    
    list.innerHTML = html;
}

function removeFav(idx) {
    try {
        idx = parseInt(idx);
        if (isNaN(idx) || idx < 0) return;
        
        if (Array.isArray(state.favorites) && idx < state.favorites.length) {
            state.favorites.splice(idx, 1);
            saveFavorites();
            renderFavorites();
            updateFavBtn();
            updateStats();
            showMsg('Favorit entfernt', true);
        }
    } catch (e) {
        console.error('Remove favorite error:', e);
    }
}

window.removeFav = removeFav;

async function shareSong() {
    const songEl = $('trackTitle');
    const artistEl = $('trackArtist');
    
    if (!songEl || !artistEl) {
        showMsg('Fehler');
        return;
    }
    
    const song = songEl.textContent;
    const artist = artistEl.textContent;
    
    if (!song || !artist || song === 'Bereit...' || song === 'Keine Daten' || song === 'Unbekannt') {
        showMsg('Kein Song verfügbar');
        return;
    }
    
    const text = `🎵 ${artist} - ${song}\n\n🎧 MadGames FM: https://laut.fm/madgamesfm`;
    
    if (navigator.share) {
        try {
            await navigator.share({ text: text });
            showMsg('Geteilt!', true);
        } catch (e) {
            if (e.name !== 'AbortError') {
                copyToClipboard(text);
            }
        }
    } else {
        copyToClipboard(text);
    }
}

function loadStats() {
    try {
        const saved = localStorage.getItem('stats');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                state.stats = {
                    songs: parseInt(parsed.songs) || 0,
                    time: parseInt(parsed.time) || 0,
                    sessionStart: parsed.sessionStart || null
                };
            }
        }
    } catch (e) {
        console.error('Load stats error:', e);
        state.stats = { songs: 0, time: 0, sessionStart: null };
    }
    updateStats();
}

function saveStats() {
    try {
        if (state.stats && typeof state.stats === 'object') {
            localStorage.setItem('stats', JSON.stringify(state.stats));
        }
    } catch (e) {
        console.error('Save stats error:', e);
    }
}

function startStats() {
    if (!state.stats.sessionStart) {
        state.stats.sessionStart = Date.now();
    }
    
    if (state.statsInterval) {
        clearInterval(state.statsInterval);
    }
    
    state.statsInterval = setInterval(() => {
        if (state.playing && state.stats.sessionStart) {
            state.stats.time += 60;
            state.stats.sessionStart = Date.now();
            saveStats();
            updateStats();
        }
    }, CFG.STATS_INTERVAL);
}

function stopStats() {
    if (state.statsInterval) {
        clearInterval(state.statsInterval);
        state.statsInterval = null;
    }
    
    if (state.stats.sessionStart) {
        const elapsed = Math.floor((Date.now() - state.stats.sessionStart) / 1000);
        state.stats.time += elapsed;
        state.stats.sessionStart = null;
        saveStats();
        updateStats();
    }
}

function updateStats() {
    const songsEl = $('statSongs');
    const timeEl = $('statTime');
    const favsEl = $('statFavs');
    
    if (songsEl) songsEl.textContent = state.stats.songs;
    if (timeEl) timeEl.textContent = formatTime(state.stats.time);
    if (favsEl) favsEl.textContent = state.favorites.length;
}

function setupEvents() {
    const playBtn = $('playBtn');
    const volSlider = $('volSlider');
    const volBtn = $('volBtn');
    const btnTheme = $('btnTheme');
    const btnNotif = $('btnNotif');
    const favBtn = $('favBtn');
    const shareBtn = $('shareBtn');
    
    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (volSlider) volSlider.addEventListener('input', e => setVolume(e.target.value));
    if (volBtn) volBtn.addEventListener('click', toggleMute);
    if (btnTheme) btnTheme.addEventListener('click', toggleTheme);
    if (btnNotif) btnNotif.addEventListener('click', toggleNotif);
    if (favBtn) favBtn.addEventListener('click', toggleFavorite);
    if (shareBtn) shareBtn.addEventListener('click', shareSong);
    
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        
        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlay();
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (volSlider) {
                    const newVol = Math.min(100, parseInt(volSlider.value) + 10);
                    volSlider.value = newVol;
                    setVolume(newVol);
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (volSlider) {
                    const newVolDown = Math.max(0, parseInt(volSlider.value) - 10);
                    volSlider.value = newVolDown;
                    setVolume(newVolDown);
                }
                break;
            case 'KeyH':
                toggleFavorite();
                break;
            case 'KeyS':
                shareSong();
                break;
        }
    });
    
    window.addEventListener('beforeunload', () => {
        stopPlay();
        stopStats();
        if (state.updateInterval) clearInterval(state.updateInterval);
        if (state.listenerInterval) clearInterval(state.listenerInterval);
    });
}

async function init() {
    try {
        const savedVol = localStorage.getItem('volume');
        if (savedVol) {
            const vol = parseFloat(savedVol);
            if (!isNaN(vol) && vol >= 0 && vol <= 1) {
                state.volume = vol;
                const pct = Math.round(vol * 100);
                const volSlider = $('volSlider');
                const volVal = $('volVal');
                if (volSlider) volSlider.value = pct;
                if (volVal) volVal.textContent = pct + '%';
            }
        }
        
        const savedMuted = localStorage.getItem('muted');
        if (savedMuted === 'true') {
            state.muted = true;
            const volIcon = $('volIcon');
            if (volIcon) volIcon.textContent = '🔇';
        }
        
        const theme = localStorage.getItem('theme');
        if (theme === 'light') {
            document.body.classList.add('light');
            const themeIcon = $('themeIcon');
            if (themeIcon) themeIcon.textContent = '☀️';
        }
        
        const notif = localStorage.getItem('notifications');
        if (notif === 'true' && 'Notification' in window && Notification.permission === 'granted') {
            state.notifications = true;
            const notifIcon = $('notifIcon');
            if (notifIcon) notifIcon.textContent = '🔔';
        }
        
        loadFavorites();
        loadStats();
        setupEvents();
        
        await updateAll();
        
        state.updateInterval = setInterval(() => {
            updateSong();
            updateHistory();
        }, CFG.UPDATE_INTERVAL);
        
        state.listenerInterval = setInterval(() => {
            updateListeners();
        }, 3000);
        
        const statusText = $('statusText');
        if (statusText) statusText.textContent = 'Bereit';
    } catch (e) {
        console.error('Init error:', e);
        showMsg('Fehler beim Laden');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}