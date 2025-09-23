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

    currentPage = pageName;
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
    // 파일 타입 검증
    if (!file.type.startsWith('video/')) {
        showNotification('오류', '비디오 파일만 업로드할 수 있습니다.', 'error');
        return;
    }

    // 파일 크기 검증 (2GB)
    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    if (file.size > maxSize) {
        showNotification('오류', '파일 크기가 2GB를 초과합니다.', 'error');
        return;
    }

    try {
        // 로딩 표시
        uploadZone.innerHTML = `
            <div class="upload-icon">⏳</div>
            <h3>업로드 중...</h3>
            <p>${file.name}</p>
        `;

        // Electron 메인 프로세스로 파일 전송
        const result = await ipcRenderer.invoke('upload-video', file.path);

        if (result.success) {
            showNotification('성공', result.message, 'success');

            // 목록 페이지로 전환
            switchPage('list');
            refreshVideoList();
        } else {
            throw new Error(result.message);
        }

    } catch (error) {
        console.error('Upload error:', error);
        showNotification('오류', '업로드에 실패했습니다.', 'error');

        // 업로드 영역 복원
        uploadZone.innerHTML = `
            <div class="upload-icon">🎬</div>
            <h3>비디오 파일을 드래그 앤 드롭하거나 클릭하세요</h3>
            <p>지원 형식: MP4, AVI, MOV, MKV</p>
        `;
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
                        <img src="${video.thumbnail || 'placeholder.png'}" alt="${video.name}">
                        <div class="video-duration">${video.duration}</div>
                    </div>
                    <div class="video-info">
                        <h4>${video.name}</h4>
                        <p>업로드: ${video.uploadDate}</p>
                        <div class="video-status status-${video.status}">${getStatusText(video.status)}</div>
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
async function startAnalysis() {
    showNotification('정보', '분석 기능은 아직 구현되지 않았습니다.', 'info');
}

// 쇼츠 생성
async function generateShorts() {
    showNotification('정보', '쇼츠 생성 기능은 아직 구현되지 않았습니다.', 'info');
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
    ollamaText.textContent = message;

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
    ollamaDot.style.backgroundColor = config.color;
    ollamaDot.style.animation = config.animation;
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

ollamaServerBtn.addEventListener('click',async ()=>{
    console.log('Ollama Serve');
    try{
        ollamaInstallBtn.disabled = true;
    }catch(e){
        console.error('Failed to start Ollama Serve')
    } 
});

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
        modelDownloadBtn.disabled = false;
        modelDownloadBtn.style.display = 'block';
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
document.addEventListener('DOMContentLoaded', () => {
    // 초기 페이지 설정
    switchPage('upload');

    // 상태 표시 업데이트
    updateStatusIndicator('프로그램 설치', 'ready');

    // Ollama 상태 확인
    checkOllamaStatus();
});
