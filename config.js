'use strict';

const CFG = {
    STATION: 'madgamesfm',
    STREAM: 'https://stream.laut.fm/madgamesfm',
    API: 'https://api.laut.fm',
    UPDATE_INTERVAL: 5000,
    TIMEOUT: 8000,
    STATS_INTERVAL: 60000,
    MAX_HISTORY: 10,
    MAX_FAVORITES: 50
};

const state = {
    audio: null,
    playing: false,
    volume: 0.7,
    muted: false,
    lastSongId: null,
    notifications: false,
    updateInterval: null,
    listenerInterval: null,
    statsInterval: null,
    favorites: [],
    reconnectAttempts: 0,
    stats: {
        songs: 0,
        time: 0,
        sessionStart: null
    }
};

const $ = id => document.getElementById(id);

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}min`;
}

function showMsg(text, isSuccess = false) {
    const msg = $('msg');
    if (!msg) return;
    
    msg.textContent = text;
    msg.className = `msg ${isSuccess ? 'success' : 'error'}`;
    msg.style.display = 'block';
    
    setTimeout(() => {
        msg.style.display = 'none';
    }, 4000);
}

function hideMsg() {
    const msg = $('msg');
    if (msg) {
        msg.style.display = 'none';
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showMsg('📋 Kopiert!', true);
        }).catch(() => {
            showMsg('Kopieren fehlgeschlagen');
        });
    }
}