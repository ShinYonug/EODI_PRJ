// Electron API
const { ipcRenderer } = require('electron');

// DOM 요소들
const navButtons = document.querySelectorAll('.nav-button');
const contentTitle = document.getElementById('content-title');
const contentBody = document.getElementById('content-body');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const ollamaDot = document.getElementById('ollama-dot');
const ollamaText = document.getElementById('ollama-text');
const ollamaInstallBtn = document.getElementById('ollama-install-btn');
const modelDownloadBtn = document.getElementById('model-download-btn');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const ollamaServerBtn = document.getElementById('ollama-server-btn');

// 페이지 내용들
const pages = {
    upload: document.getElementById('upload-page'),
    list: document.getElementById('list-page'),
    shorts: document.getElementById('shorts-page')
};

// 메뉴 타이틀들
const pageTitles = {
    upload: '업로드',
    list: '목록',
    shorts: '쇼츠생성'
};

// 현재 활성 페이지
let currentPage = 'upload';

// 메뉴 버튼 클릭 이벤트
navButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetPage = button.id.replace('-btn', '');

        // 활성 버튼 변경
        navButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // 페이지 전환
        switchPage(targetPage);
    });
});

// 페이지 전환 함수
function switchPage(pageName) {
    // 현재 페이지 숨기기
    Object.values(pages).forEach(page => page.classList.add('hidden'));

    // 새 페이지 표시
    pages[pageName].classList.remove('hidden');

    // 타이틀 변경
    contentTitle.textContent = pageTitles[pageName];

    // 액션 버튼들 업데이트
    updateActionButtons(pageName);

    // 좌측 메뉴 활성 상태 업데이트
    navButtons.forEach(btn => {
        if (btn.id === `${pageName}-btn`) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    currentPage = pageName;

    // 목록 페이지로 전환 시 자동 새로고침
    if (pageName === 'list') {
        refreshVideoList();
    }
    
    // 쇼츠 생성 페이지로 전환 시 분석 완료된 비디오 목록 로드
    if (pageName === 'shorts') {
        refreshShortsVideoList();
    }
}

// 액션 버튼 업데이트 함수
function updateActionButtons(pageName) {
    const contentActions = document.querySelector('.content-actions');
    contentActions.innerHTML = ''; // 기존 버튼들 제거

    switch (pageName) {
        case 'upload':
            // 업로드 페이지에서는 추가 액션 버튼 없음
            break;

        case 'list':
            // 목록 페이지 액션 버튼들
            const refreshBtn = createActionButton('새로고침', '🔄', refreshVideoList);
            const analyzeBtn = createActionButton('분석 시작', '▶️', startAnalysis);
            contentActions.appendChild(refreshBtn);
            contentActions.appendChild(analyzeBtn);
            break;

        case 'shorts':
            // 쇼츠생성 페이지 액션 버튼들
            const generateBtn = createActionButton('쇼츠 생성', '✂️', generateShorts);
            const settingsBtn = createActionButton('설정', '⚙️', openSettings);
            contentActions.appendChild(generateBtn);
            contentActions.appendChild(settingsBtn);
            break;
    }
}

// 액션 버튼 생성 함수
function createActionButton(text, icon, onClick) {
    const button = document.createElement('button');
    button.className = 'action-button';
    button.innerHTML = `<span class="action-icon">${icon}</span> ${text}`;
    button.addEventListener('click', onClick);
    return button;
}

// 업로드 영역 이벤트들
uploadZone.addEventListener('click', () => {
    fileInput.click();
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '#667eea';
    uploadZone.style.backgroundColor = '#f0f4ff';
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = '#cbd5e0';
    uploadZone.style.backgroundColor = '#f8f9fa';
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '#cbd5e0';
    uploadZone.style.backgroundColor = '#f8f9fa';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileUpload(files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

// 파일 업로드 처리 함수
async function handleFileUpload(file) {
    // 확장자 검증 (파일명과 무관하게 확장자만 체크)
    const allowedExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedExtensions.includes(fileExtension)) {
        showNotification('오류', '지원하지 않는 파일 형식입니다. (MP4, AVI, MOV, MKV, WMV, FLV, WebM만 지원)', 'error');
        return;
    }


    try {
        // 로딩 표시
        uploadZone.innerHTML = `
            <div class="upload-icon">⏳</div>
            <h3>업로드 중...</h3>
            <p>${file.name}</p>
            <div class="upload-progress">
                <div class="progress-bar-upload">
                    <div class="progress-fill-upload" id="upload-progress-fill"></div>
                </div>
                <div class="progress-text-upload" id="upload-progress-text">준비 중...</div>
            </div>
        `;

        // 청크 방식으로 파일 업로드
        const result = await uploadFileInChunks(file);

        if (result.success) {
            // 업로드 영역 복원
            uploadZone.innerHTML = `
                <div class="upload-icon">🎬</div>
                <h3>비디오 파일을 드래그 앤 드롭하거나 클릭하세요</h3>
            `;

            showNotification('성공', result.message, 'success');

            // 목록 페이지로 전환
            const listButton = document.getElementById('list-btn');
            const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            listButton.dispatchEvent(clickEvent);
        } else {
            throw new Error(result.message || '업로드 실패');
        }

    } catch (error) {
        console.error('Upload error:', error);
        showNotification('오류', `업로드에 실패했습니다: ${error.message}`, 'error');

        // 업로드 영역 복원
        uploadZone.innerHTML = `
            <div class="upload-icon">🎬</div>
            <h3>비디오 파일을 드래그 앤 드롭하거나 클릭하세요</h3>
        `;
    }
}

// 청크 방식 파일 업로드 함수
async function uploadFileInChunks(file) {
    const chunkSize = 1024 * 1024; // 1MB 청크
    const totalChunks = Math.ceil(file.size / chunkSize);

    // 초기화 요청
    const initResponse = await fetch('http://127.0.0.1:8000/upload/init', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filename: file.name,
            fileSize: file.size,
            totalChunks: totalChunks
        })
    });

    if (!initResponse.ok) {
        throw new Error('업로드 초기화 실패');
    }

    const { uploadId } = await initResponse.json();

    // 청크별 업로드
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', totalChunks);
        formData.append('chunk', chunk);

        const chunkResponse = await fetch('http://127.0.0.1:8000/upload/chunk', {
            method: 'POST',
            body: formData
        });

        if (!chunkResponse.ok) {
            throw new Error(`청크 ${chunkIndex + 1}/${totalChunks} 업로드 실패`);
        }

        // 진행률 업데이트
        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        const progressFill = document.getElementById('upload-progress-fill');
        const progressText = document.getElementById('upload-progress-text');

        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
        if (progressText) {
            progressText.textContent = `업로드 중... ${progress}%`;
        }
    }

    // 완료 요청
    const completeResponse = await fetch('http://127.0.0.1:8000/upload/complete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uploadId })
    });

    if (!completeResponse.ok) {
        throw new Error('업로드 완료 처리 실패');
    }

    return await completeResponse.json();
}

// 업로드 진행률 표시 함수
function updateUploadProgress(progress, message) {
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');

    if (progressFill) {
        progressFill.style.width = `${progress}%`;
    }
    if (progressText) {
        progressText.textContent = message;
    }
}

// 비디오 목록 새로고침
async function refreshVideoList() {
    try {
        const videoList = await ipcRenderer.invoke('get-video-list');
        updateVideoListDisplay(videoList);
    } catch (error) {
        console.error('Failed to get video list:', error);
        showNotification('오류', '비디오 목록을 불러오는데 실패했습니다.', 'error');
    }
}

// 비디오 목록 표시 업데이트
function updateVideoListDisplay(videos) {
    const videoListContainer = document.querySelector('.video-list');

    if (videos.length === 0) {
        videoListContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <h3>업로드된 비디오가 없습니다</h3>
                <p>좌측 메뉴에서 '업로드'를 클릭하여 비디오를 추가하세요</p>
            </div>
        `;
        return;
    }

    // 비디오 목록 표시 (나중에 구현)
    videoListContainer.innerHTML = `
        <div class="video-grid">
            ${videos.map(video => `
                <div class="video-item" data-id="${video.id}">
                    <div class="video-thumbnail">
                        <img src="${video.thumbnail ? 'http://127.0.0.1:8000' + video.thumbnail : '/assets/placeholder.jpg'}" 
                             alt="${video.original_name || video.filename}" 
                             onerror="this.src='/assets/placeholder.jpg'">
                        <div class="video-duration">${video.duration || '00:00'}</div>
                    </div>
                    <div class="video-info">
                        <h4>${video.original_name || video.filename}</h4>
                        <p>업로드: ${new Date(video.uploaded_at).toLocaleString()}</p>
                        <div class="video-status status-${video.status}">${getStatusText(video.status)}</div>
                        <button onclick="startAnalysis(${video.id})" class="analyze-btn">분석하기</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// 상태 텍스트 변환
function getStatusText(status) {
    const statusMap = {
        'uploaded': '업로드됨',
        'analyzing': '분석 중',
        'completed': '완료',
        'failed': '실패'
    };
    return statusMap[status] || '알 수 없음';
}

// 분석 시작
async function startAnalysis(videoId) {
    try {
        // 1. 즉시 UI를 "분석 중" 상태로 업데이트
        updateVideoStatusInUI(videoId, 'analyzing', 0);
        
        const result = await ipcRenderer.invoke('analyze-video', videoId);
        if (result.success) {
            showNotification('성공', result.message, 'success');
            
            // 2. 분석 진행 상황을 주기적으로 체크 (첫 새로고침은 3초 후)
            startAnalysisPolling(videoId);
        } else {
            // 실패 시 상태 복원
            await refreshVideoList();
            throw new Error(result.message || '분석 시작 실패');
        }
    } catch (error) {
        console.error('Analysis error:', error);
        showNotification('오류', error.message, 'error');
        // 에러 시 목록 새로고침
        await refreshVideoList();
    }
}

// UI에서 비디오 상태 즉시 업데이트
function updateVideoStatusInUI(videoId, status, progress = 0) {
    const videoItem = document.querySelector(`.video-item[data-id="${videoId}"]`);
    if (videoItem) {
        const statusElement = videoItem.querySelector('.video-status');
        const analyzeBtn = videoItem.querySelector('.analyze-btn');
        
        if (statusElement) {
            statusElement.textContent = getStatusText(status);
            statusElement.className = `video-status status-${status}`;
        }
        
        if (analyzeBtn) {
            if (status === 'analyzing') {
                analyzeBtn.disabled = true;
                analyzeBtn.textContent = '분석 중...';
            } else {
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = '분석하기';
            }
        }
    }
}

// 분석 진행 상황 폴링
function startAnalysisPolling(videoId) {
    // 첫 번째 체크를 3초 후에 시작 (즉시 호출 방지)
    const pollInterval = setInterval(async () => {
        try {
            const videoList = await ipcRenderer.invoke('get-video-list');
            const video = videoList.videos.find(v => v.id === videoId);
            
            if (video) {
                if (video.status === 'completed') {
                    clearInterval(pollInterval);
                    showNotification('완료', '비디오 분석이 완료되었습니다!', 'success');
                    // 완료 시 자동 새로고침
                    await refreshVideoList();
                } else if (video.status === 'failed') {
                    clearInterval(pollInterval);
                    showNotification('실패', '비디오 분석이 실패했습니다.', 'error');
                    // 실패 시 자동 새로고침
                    await refreshVideoList();
                } else if (video.status === 'analyzing') {
                    // 분석 중일 때는 단순히 "분석 중..." 표시
                    updateVideoStatusInUI(videoId, 'analyzing');
                    console.log('분석 진행 중...');
                }
            }
        } catch (error) {
            console.error('Polling error:', error);
            clearInterval(pollInterval);
        }
    }, 3000); // 3초마다 체크 (더 빠른 응답)
    
    // 10분 후 자동 종료 (타임아웃)
    setTimeout(() => {
        clearInterval(pollInterval);
    }, 600000);
}

// 쇼츠 생성용 분석 완료된 비디오 목록 새로고침
async function refreshShortsVideoList() {
    try {
        const response = await fetch('http://127.0.0.1:8000/shorts/videos');
        const data = await response.json();
        updateShortsVideoListDisplay(data.videos || []);
    } catch (error) {
        console.error('Failed to get shorts video list:', error);
        showNotification('오류', '쇼츠용 비디오 목록을 불러오는데 실패했습니다.', 'error');
    }
}

// 쇼츠용 비디오 목록 표시 업데이트
function updateShortsVideoListDisplay(videos) {
    const shortsVideoListContainer = document.querySelector('.shorts-video-list');

    if (!videos || videos.length === 0) {
        shortsVideoListContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">✂️</div>
                <h3>쇼츠 생성 가능한 비디오가 없습니다</h3>
                <p>먼저 비디오를 업로드하고 분석을 완료해주세요.</p>
            </div>
        `;
        return;
    }

    // 쇼츠용 비디오 목록 표시
    shortsVideoListContainer.innerHTML = `
        <div class="shorts-video-grid">
            ${videos.map(video => `
                <div class="shorts-video-item" data-id="${video.id}">
                    <div class="video-thumbnail">
                        <img src="${video.thumbnail ? 'http://127.0.0.1:8000' + video.thumbnail : '/assets/placeholder.jpg'}" 
                             alt="${video.original_name}" 
                             onerror="this.src='/assets/placeholder.jpg'">
                        <div class="video-duration">${video.duration || '00:00'}</div>
                    </div>
                    <div class="video-info">
                        <h4>${video.original_name}</h4>
                        <div class="video-stats">
                            <span class="scene-count">🎬 ${video.total_scenes}개 장면</span>
                            <span class="mood-indicator mood-${video.dominant_mood}">${getMoodText(video.dominant_mood)}</span>
                        </div>
                        <p class="upload-date">업로드: ${new Date(video.uploaded_at).toLocaleString()}</p>
                        ${getShortsButton(video)}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// 분위기 텍스트 변환
function getMoodText(mood) {
    const moodMap = {
        'happy': '😊 즐거움',
        'sad': '😢 슬픔',
        'excited': '🤩 흥미진진',
        'calm': '😌 평온',
        'tense': '😰 긴장',
        'dramatic': '🎭 드라마틱',
        'neutral': '😐 중성',
        'unknown': '❓ 알 수 없음'
    };
    return moodMap[mood] || '😐 중성';
}

// 쇼츠 버튼 상태에 따른 HTML 생성
function getShortsButton(video) {
    const shortsStatus = video.shorts_status || 'none';
    
    switch (shortsStatus) {
        case 'generating':
            return `
                <button class="generate-shorts-btn generating" disabled>
                    ⏳ 쇼츠 생성 중...
                </button>
            `;
        case 'completed':
            return `
                <button class="generate-shorts-btn completed" disabled>
                    ✅ 생성 완료 (${video.shorts_clips_count}개 클립)
                </button>
            `;
        case 'failed':
            return `
                <button onclick="generateShorts(${video.id})" class="generate-shorts-btn failed">
                    ❌ 재시도
                </button>
            `;
        default:
            return `
                <button onclick="generateShorts(${video.id})" class="generate-shorts-btn">
                    ✂️ 쇼츠 생성
                </button>
            `;
    }
}

// 쇼츠 생성
async function generateShorts(videoId) {
    try {
        // 버튼 상태를 즉시 '생성 중'으로 변경
        updateShortsButtonStatus(videoId, 'generating');
        
        const response = await fetch(`http://127.0.0.1:8000/shorts/generate/${videoId}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('성공', result.message, 'success');
            // 쇼츠 생성 상태 폴링 시작
            startShortsPolling(videoId);
        } else {
            // 실패 시 버튼 상태 복원
            updateShortsButtonStatus(videoId, 'failed');
            throw new Error(result.message || '쇼츠 생성 요청 실패');
        }
    } catch (error) {
        console.error('Shorts generation error:', error);
        showNotification('오류', error.message, 'error');
        updateShortsButtonStatus(videoId, 'failed');
    }
}

// 쇼츠 버튼 상태 업데이트
function updateShortsButtonStatus(videoId, status, clipsCount = 0) {
    const videoItem = document.querySelector(`.shorts-video-item[data-id="${videoId}"]`);
    if (videoItem) {
        const buttonContainer = videoItem.querySelector('.video-info');
        const video = { id: videoId, shorts_status: status, shorts_clips_count: clipsCount };
        
        // 기존 버튼 제거 후 새 버튼 추가
        const oldButton = buttonContainer.querySelector('.generate-shorts-btn');
        if (oldButton) {
            oldButton.outerHTML = getShortsButton(video);
        }
    }
}

// 쇼츠 생성 상태 폴링
function startShortsPolling(videoId) {
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch('http://127.0.0.1:8000/shorts/videos');
            const data = await response.json();
            const video = data.videos.find(v => v.id === videoId);
            
            if (video) {
                if (video.shorts_status === 'completed') {
                    clearInterval(pollInterval);
                    updateShortsButtonStatus(videoId, 'completed', video.shorts_clips_count);
                    showNotification('완료', `쇼츠 생성이 완료되었습니다! (${video.shorts_clips_count}개 클립)`, 'success');
                } else if (video.shorts_status === 'failed') {
                    clearInterval(pollInterval);
                    updateShortsButtonStatus(videoId, 'failed');
                    showNotification('실패', '쇼츠 생성이 실패했습니다.', 'error');
                }
            }
        } catch (error) {
            console.error('Shorts polling error:', error);
        }
    }, 3000); // 3초마다 체크
    
    // 5분 후 자동 종료
    setTimeout(() => {
        clearInterval(pollInterval);
    }, 300000);
}

// 설정 열기
function openSettings() {
    showNotification('정보', '설정 기능은 아직 구현되지 않았습니다.', 'info');
}

// 알림 표시 함수
function showNotification(title, message, type = 'info') {
    // 간단한 알림 구현 (나중에 개선 가능)
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-header">
            <strong>${title}</strong>
            <button class="notification-close">&times;</button>
        </div>
        <div class="notification-body">${message}</div>
    `;

    // 알림 스타일 추가
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 400px;
        background: white;
        border-left: 4px solid ${type === 'error' ? '#e53e3e' : type === 'success' ? '#38a169' : '#3182ce'};
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    // 닫기 버튼 이벤트
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.remove();
    });

    // 5초 후 자동 제거
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// 상태 표시기 업데이트
function updateStatusIndicator(text, status) {
    statusText.textContent = text;

    // 상태에 따른 색상 변경
    const colors = {
        ready: '#4caf50',
        busy: '#ff9800',
        error: '#f44336'
    };

    statusDot.style.backgroundColor = colors[status] || colors.ready;
}

// Ollama 상태 업데이트
function updateOllamaStatus(status, message) {
    // 안전하게 매 호출마다 DOM을 다시 조회 (초기화 타이밍 이슈 대응)
    const indicator = document.querySelector('.ollama-indicator');
    const dotEl = document.getElementById('ollama-dot');
    const textEl = document.getElementById('ollama-text');

    // 숨겨져 있다면 표시
    if (indicator && indicator.style.display === 'none') {
        indicator.style.display = 'flex';
    }

    if (textEl && typeof message === 'string') {
        textEl.textContent = message;
    }

    // 상태에 따른 색상 및 애니메이션 변경
    const statusConfig = {
        checking: { color: '#ff9800', animation: 'pulse 2s infinite' },
        installing: { color: '#ff9800', animation: 'pulse 1s infinite' },
        starting: { color: '#2196f3', animation: 'pulse 1.5s infinite' },
        downloading: { color: '#ff5722', animation: 'pulse 1s infinite' },
        ready: { color: '#4caf50', animation: 'none' },
        error: { color: '#f44336', animation: 'none' }
    };

    const config = statusConfig[status] || statusConfig.checking;
    if (dotEl) {
        dotEl.style.backgroundColor = config.color;
        dotEl.style.animation = config.animation;
    }
}

// Ollama 설치 버튼 이벤트
ollamaInstallBtn.addEventListener('click', async () => {
    console.log('Starting Ollama installation...');

    // 버튼 비활성화
    ollamaInstallBtn.disabled = true;
    ollamaInstallBtn.textContent = '설치 중...';

    try {
        // 메인 프로세스에 Ollama 설치 요청
        const result = await ipcRenderer.invoke('install-ollama');

        if (result.success) {
            console.log('Ollama installation completed successfully');
            // 설치 완료 후 모델 다운로드 버튼 활성화
            modelDownloadBtn.disabled = false;
            ollamaInstallBtn.style.display = 'none';
            checkModelStatus(); // 모델 상태 확인
        } else {
            console.error('Ollama installation failed:', result.error);
            showNotification('오류', `Ollama 설치 실패: ${result.error}`, 'error');

            // 버튼 복원
            ollamaInstallBtn.disabled = false;
            ollamaInstallBtn.textContent = 'Ollama 설치';
        }
    } catch (error) {
        console.error('Failed to start Ollama installation:', error);
        showNotification('오류', 'Ollama 설치 시작에 실패했습니다.', 'error');

        // 버튼 복원
        ollamaInstallBtn.disabled = false;
        ollamaInstallBtn.textContent = 'Ollama 설치';
    }
});

if (ollamaServerBtn) {
    ollamaServerBtn.addEventListener('click', async () => {
        console.log('Ollama Serve');
        try {
            ollamaInstallBtn.disabled = true;
            // 서버 시작은 메인 프로세스에 위임 (필요 시 IPC 호출 추가)
            // await ipcRenderer.invoke('start-ollama-server');
        } catch (e) {
            console.error('Failed to start Ollama Serve');
        }
    });
}

// 모델 다운로드 버튼 이벤트
modelDownloadBtn.addEventListener('click', async () => {
    console.log('Starting model download...');

    // 버튼 비활성화
    modelDownloadBtn.disabled = true;
    modelDownloadBtn.textContent = '다운로드 중...';

    try {
        // 메인 프로세스에 모델 다운로드 요청
        const result = await ipcRenderer.invoke('download-model');

        if (result.success) {
            console.log('Model download completed successfully');
            // 다운로드 완료 후 버튼 숨기기
            modelDownloadBtn.style.display = 'none';
        } else {
            console.error('Model download failed:', result.error);
            showNotification('오류', `모델 다운로드 실패: ${result.error}`, 'error');

            // 버튼 복원
            modelDownloadBtn.disabled = false;
            modelDownloadBtn.textContent = '모델 다운로드';
        }
    } catch (error) {
        console.error('Failed to start model download:', error);
        showNotification('오류', '모델 다운로드 시작에 실패했습니다.', 'error');

        // 버튼 복원
        modelDownloadBtn.disabled = false;
        modelDownloadBtn.textContent = '모델 다운로드';
    }
});

// Ollama 및 모델 상태 확인 함수
async function checkOllamaStatus() {
    try {
        const result = await ipcRenderer.invoke('check-ollama-status');
        console.log('Ollama status check result:', result);

        if (result.ollamaInstalled) {
            ollamaInstallBtn.style.display = 'none';
            if (result.modelReady) {
                modelDownloadBtn.style.display = 'none';
                updateOllamaStatus('ready', '모두 준비됨');
            } else {
                modelDownloadBtn.disabled = false;
                updateOllamaStatus('ready', 'Ollama 준비됨');
            }
        } else {
            ollamaInstallBtn.disabled = false;
            modelDownloadBtn.disabled = true;
            updateOllamaStatus('waiting', '설치 필요');
        }
    } catch (error) {
        console.error('Failed to check Ollama status:', error);
        updateOllamaStatus('error', '상태 확인 실패');
    }
}

async function checkModelStatus() {
    try {
        const result = await ipcRenderer.invoke('check-model-status');
        if (result.modelReady) {
            modelDownloadBtn.style.display = 'none';
            updateOllamaStatus('ready', '모두 준비됨');
        } else {
            modelDownloadBtn.disabled = false;
        }
    } catch (error) {
        console.error('Failed to check model status:', error);
    }
}

// Ollama 설치 버튼 이벤트
ollamaInstallBtn.addEventListener('click', async () => {
    console.log('Starting Ollama installation...');

    // 버튼 비활성화
    ollamaInstallBtn.disabled = true;
    ollamaInstallBtn.textContent = '설치 중...';

    try {
        // 메인 프로세스에 Ollama 설치 요청
        const result = await ipcRenderer.invoke('install-ollama');

        if (result.success) {
            console.log('Ollama installation completed successfully');
            // 설치 완료 후 모델 다운로드 버튼 활성화
            modelDownloadBtn.disabled = false;
            ollamaInstallBtn.style.display = 'none';
            checkModelStatus(); // 모델 상태 확인
        } else {
            console.error('Ollama installation failed:', result.error);
            showNotification('오류', `Ollama 설치 실패: ${result.error}`, 'error');

            // 버튼 복원
            ollamaInstallBtn.disabled = false;
            ollamaInstallBtn.textContent = 'Ollama 설치';
        }
    } catch (error) {
        console.error('Failed to start Ollama installation:', error);
        showNotification('오류', 'Ollama 설치 시작에 실패했습니다.', 'error');

        // 버튼 복원
        ollamaInstallBtn.disabled = false;
        ollamaInstallBtn.textContent = 'Ollama 설치';
    }
});

// 모델 다운로드 버튼 이벤트
modelDownloadBtn.addEventListener('click', async () => {
    console.log('Starting model download...');

    // 버튼 비활성화 및 진행률 표시 활성화
    modelDownloadBtn.disabled = true;
    modelDownloadBtn.textContent = '다운로드 중...';
    progressContainer.style.display = 'block';
    updateDownloadProgress(0, '다운로드 시작 중...');

    try {
        // 메인 프로세스에 모델 다운로드 요청
        const result = await ipcRenderer.invoke('download-model');

        if (result.success) {
            console.log('Model download completed successfully');
            updateDownloadProgress(100, '다운로드 완료!');
            // 다운로드 완료 후 버튼 숨기기
            setTimeout(() => {
                modelDownloadBtn.style.display = 'none';
                progressContainer.style.display = 'none';
            }, 2000);
        } else {
            console.error('Model download failed:', result.error);
            showNotification('오류', `모델 다운로드 실패: ${result.error}`, 'error');

            // 버튼 복원 및 진행률 숨기기
            modelDownloadBtn.disabled = false;
            modelDownloadBtn.textContent = '모델 다운로드';
            progressContainer.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to start model download:', error);
        showNotification('오류', '모델 다운로드 시작에 실패했습니다.', 'error');

        // 버튼 복원 및 진행률 숨기기
        modelDownloadBtn.disabled = false;
        modelDownloadBtn.textContent = '모델 다운로드';
        progressContainer.style.display = 'none';
    }
});

// 다운로드 진행률 표시 함수
function updateDownloadProgress(progress, message) {
    if (progress >= 0) {
        progressFill.style.width = `${progress}%`;
    }
    progressText.textContent = message;
}

// Ollama 상태 이벤트 리스너
ipcRenderer.on('ollama-status', (event, data) => {
    console.log('Ollama status update:', data);
    updateOllamaStatus(data.status, data.message);

    // 상태에 따른 버튼 처리
    if (data.status === 'ready') {
        ollamaInstallBtn.style.display = 'none';
        modelDownloadBtn.style.display = 'none'; // ready면 버튼 숨김
        progressContainer.style.display = 'none';
    } else if (data.status === 'error') {
        ollamaInstallBtn.disabled = false;
        ollamaInstallBtn.textContent = '설치 다시 시도';
        modelDownloadBtn.disabled = true;
        progressContainer.style.display = 'none';
    } else if (data.status === 'installing') {
        ollamaInstallBtn.disabled = true;
        modelDownloadBtn.disabled = true;
    }
});

// 다운로드 진행률 이벤트 리스너
ipcRenderer.on('download-progress', (event, data) => {
    console.log('Download progress:', data);
    updateDownloadProgress(data.progress, data.message);
});

// 앱 초기화
document.addEventListener('DOMContentLoaded', async () => {
    // 초기 페이지 설정만 수행
    switchPage('upload');

    // 초기 상태: 체크 중 UI, 버튼 숨김 (메인 프로세스에서 상태 수신 대기)
    updateOllamaStatus('checking', '상태 확인 중...');
    ollamaInstallBtn.style.display = 'none';
    modelDownloadBtn.style.display = 'none';

    // 렌더 이후에도 서버가 늦게 올라오는 경우 대비 폴링 시작
    startStatusPolling();
});

// 상태 폴링: 준비 완료되면 자동 종료
let statusPollingTimer = null;
async function startStatusPolling() {
    if (statusPollingTimer) return;
    statusPollingTimer = setInterval(async () => {
        try {
            const result = await ipcRenderer.invoke('check-ollama-status');
            // 버튼/상태 업데이트
            applyStatusUI(result);

            if (result.ollamaInstalled && result.serverRunning && result.modelReady) {
                clearInterval(statusPollingTimer);
                statusPollingTimer = null;
            }
        } catch (e) {
            console.error('Status polling failed:', e);
        }
    }, 1000);
}

function applyStatusUI(result) {
    console.log('applyStatusUI input:', result);
    if (result.ollamaInstalled && result.serverRunning && result.modelReady) {
        updateOllamaStatus('ready', '모두 준비됨');
        ollamaInstallBtn.style.display = 'none';
        modelDownloadBtn.style.display = 'none';
        console.log('applyStatusUI: set ready -> 모두 준비됨');
        return;
    }

    if (!result.ollamaInstalled) {
        updateOllamaStatus('error', 'Ollama 설치 필요');
        ollamaInstallBtn.style.display = 'block';
        ollamaInstallBtn.disabled = false;
        modelDownloadBtn.style.display = 'none';
        console.log('applyStatusUI: show install button');
        return;
    }

    if (result.ollamaInstalled && !result.serverRunning) {
        updateOllamaStatus('starting', 'Ollama 서버 시작 필요');
        ollamaInstallBtn.style.display = 'none';
        modelDownloadBtn.style.display = 'none';
        console.log('applyStatusUI: waiting server start');
        return;
    }

    if (result.ollamaInstalled && result.serverRunning && !result.modelReady) {
        updateOllamaStatus('ready', 'Ollama 준비됨 (모델 필요)');
        ollamaInstallBtn.style.display = 'none';
        modelDownloadBtn.style.display = 'block';
        modelDownloadBtn.disabled = false;
        console.log('applyStatusUI: model needed');
        return;
    }
}

// 디버그 헬퍼: 렌더러 콘솔에서 window.debugCheck() 호출
window.debugCheck = async () => {
    try {
        const r = await ipcRenderer.invoke('check-ollama-status');
        console.log('debugCheck result:', r);
        applyStatusUI(r);
        return r;
    } catch (e) {
        console.error('debugCheck error:', e);
        return null;
    }
};
