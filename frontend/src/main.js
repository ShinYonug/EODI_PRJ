const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;
let ollamaProcess = null;

// OS별 Ollama 경로 설정
function getOllamaPaths() {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (platform === 'win32') {
    // Windows: C:\EODI 폴더
    return {
      installPath: 'C:\\EODI\\ollama',
      exePath: 'C:\\EODI\\ollama\\ollama.exe',
      checkCommand: 'where ollama',
      commonPaths: ['C:\\EODI\\ollama\\ollama.exe']
    };
  } else if (platform === 'darwin') {
    // macOS: Homebrew 경로 우선 확인
    return {
      installPath: '/opt/homebrew/bin/ollama',
      exePath: '/opt/homebrew/bin/ollama',
      checkCommand: 'which ollama',
      commonPaths: [
        '/opt/homebrew/bin/ollama',  // Homebrew 경로
        path.join(homeDir, 'Desktop', 'ollama', 'ollama'),  // Desktop 경로
        '/usr/local/bin/ollama'  // 기본 경로
      ]
    };
  } else {
    // Linux 등 다른 OS
    return {
      installPath: '/usr/local/bin/ollama',
      exePath: '/usr/local/bin/ollama',
      checkCommand: 'which ollama',
      commonPaths: ['/usr/local/bin/ollama']
    };
  }
}

// Ollama 설치 상태 확인
function checkOllamaInstalled() {
  return new Promise((resolve) => {
    const paths = getOllamaPaths();

    // 1. PATH에서 실행 확인
    exec('ollama --version 2>&1', (error, stdout, stderr) => {
      console.log('ollama --version result:', { error: error?.code, stdout: stdout.trim(), stderr: stderr.trim() });

      // stderr에 버전 정보가 나올 수 있음
      const output = stdout + stderr;
      if (output.includes('client version is') || (!error && output.trim())) {
        console.log('Ollama is installed and working');
        resolve(true);
        return;
      }

      // 2. 지정된 exePath 확인
      fs.access(paths.exePath, fs.constants.F_OK, (err) => {
        if (!err) {
          console.log('Ollama found at:', paths.exePath);
          resolve(true);
        } else {
          console.log('Ollama not found');
          resolve(false);
        }
      });
    });
  });
}

// Ollama 서버가 실행 중인지 확인 (수정된 함수)
function checkOllamaServerRunning() {
  return new Promise((resolve) => {
    exec('curl -s http://localhost:11434/api/tags', (error, stdout) => {
      if (error) {
        console.log('Ollama server not running');
        resolve(false);
        return;
      }

      try {
        JSON.parse(stdout);
        console.log('Ollama server is already running');
        resolve(true);
      } catch (e) {
        console.log('Ollama server response invalid');
        resolve(false);
      }
    });
  });
}

// Ollama 설치
function installOllama() {
  return new Promise((resolve, reject) => {
    console.log('Installing Ollama...');

    const platform = os.platform();

    if (platform === 'darwin') {
      // macOS: Homebrew를 사용하여 설치
      console.log('Installing Ollama via Homebrew on macOS...');

      const installProcess = spawn('brew', ['install', 'ollama'], {
        stdio: 'pipe'
      });

      let hasError = false;

      installProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Brew stdout:', output);

        // 설치 완료 메시지 확인
        if (output.includes('🍺') && output.includes('ollama')) {
          console.log('Ollama installation completed on macOS');
          resolve(true);
        }
      });

      installProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('Brew stderr:', output);

        // 에러 메시지 확인
        if (output.includes('Error') || output.includes('failed') || output.includes('locked')) {
          hasError = true;
        }
      });

      installProcess.on('close', (code) => {
        if (code === 0 && !hasError) {
          console.log('Ollama installation process completed successfully');
          resolve(true);
        } else {
          console.error(`Ollama installation failed with code ${code}`);
          resolve(false);
        }
      });

      installProcess.on('error', (error) => {
        console.error('Brew install error:', error);
        resolve(false);
      });

    } else if (platform === 'win32') {
      // Windows: 공식 설치 스크립트 사용
      const installProcess = spawn('powershell', [
        '-Command',
        'Invoke-WebRequest -Uri "https://ollama.ai/download/OllamaSetup.exe" -OutFile "$env:TEMP\\OllamaSetup.exe"; Start-Process -FilePath "$env:TEMP\\OllamaSetup.exe" -ArgumentList "/S" -Wait'
      ], {
        stdio: 'inherit'
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Ollama installation completed on Windows');
          resolve(true);
        } else {
          console.error(`Ollama installation failed with code ${code}`);
          resolve(false);
        }
      });

      installProcess.on('error', (error) => {
        console.error('Windows install error:', error);
        resolve(false);
      });

    } else {
      // Linux: 기존 방식 사용
      const installProcess = spawn('curl', ['-fsSL', 'https://ollama.ai/install.sh', '|', 'sh'], {
        stdio: 'inherit',
        shell: true
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Ollama installation completed on Linux');
          resolve(true);
        } else {
          console.error(`Ollama installation failed with code ${code}`);
          resolve(false);
        }
      });

      installProcess.on('error', (error) => {
        console.error('Linux install error:', error);
        resolve(false);
      });
    }
  });
}

// Ollama 서버 시작
function startOllamaServer() {
  return new Promise(async (resolve, reject) => {
    console.log('Checking Ollama server status...');

    // 먼저 서버가 이미 실행 중인지 확인
    const isRunning = await checkOllamaServerRunning();
    if (isRunning) {
      console.log('Ollama server is already running, verifying connection...');

      // 서버가 실행 중이라도 연결이 제대로 되는지 다시 확인
      let retries = 0;
      const maxRetries = 3;

      const verifyConnection = () => {
        checkOllamaServerRunning().then((stillRunning) => {
          if (stillRunning) {
            console.log('Ollama server connection verified');
            resolve();
          } else if (retries < maxRetries) {
            retries++;
            console.log(`Server connection check failed, retry ${retries}/${maxRetries}`);
            setTimeout(verifyConnection, 2000);
          } else {
            console.log('Server connection verification failed, starting new server');
            startNewServer();
          }
        }).catch(() => {
          if (retries < maxRetries) {
            retries++;
            console.log(`Server connection check failed, retry ${retries}/${maxRetries}`);
            setTimeout(verifyConnection, 2000);
          } else {
            console.log('Server connection verification failed, starting new server');
            startNewServer();
          }
        });
      };

      verifyConnection();
      return;
    }

    // 서버가 실행 중이지 않으면 새로 시작
    startNewServer();

    function startNewServer() {
      console.log('Starting new Ollama server with optimized settings...');

      const paths = getOllamaPaths();

    // PATH에 있는 ollama 우선 사용, 없으면 지정된 경로 사용
    exec('which ollama', (error, stdout) => {
      const ollamaCmd = error ? paths.exePath : 'ollama';

      // M4 Max 최적화된 Ollama 환경변수 설정
      const optimizedEnv = {
        ...process.env,
        OLLAMA_NUM_PARALLEL: '1',           // 단일 모델 전용 (순차 처리)
        OLLAMA_MAX_LOADED_MODELS: '1',      // 모델 1개만 로드
        OLLAMA_FLASH_ATTENTION: '1',        // Flash Attention 활성화
        OLLAMA_NUM_GPU: '40',               // M4 Max 40개 GPU 코어 명시적 사용
        OLLAMA_KEEP_ALIVE: '15m',           // 모델 15분간 메모리 유지
        OLLAMA_GPU_LAYERS: '99',            // 모든 레이어를 GPU에서 처리
        OLLAMA_LOAD_TIMEOUT: '300',         // 로드 타임아웃 5분
        OLLAMA_GPU_MEMORY_FRACTION: '0.9',  // 통합 메모리 90% 사용
        OLLAMA_MAX_QUEUE: '5',              // 대기열 크기 (단일 모델용)
        OLLAMA_CONTEXT_LENGTH: '8192'       // 컨텍스트 길이 설정
      };

      console.log('Ollama environment variables:', {
        OLLAMA_NUM_PARALLEL: optimizedEnv.OLLAMA_NUM_PARALLEL,
        OLLAMA_MAX_LOADED_MODELS: optimizedEnv.OLLAMA_MAX_LOADED_MODELS,
        OLLAMA_GPU_MEMORY_FRACTION: optimizedEnv.OLLAMA_GPU_MEMORY_FRACTION
      });

      ollamaProcess = spawn(ollamaCmd, ['serve'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: optimizedEnv  // 최적화된 환경변수 적용
      });

      let serverReady = false;

      const checkServerReady = (data) => {
        const output = data.toString();
        console.log('Ollama output:', output);

        if ((output.includes('listening on') || output.includes('Listening on')) && !serverReady) {
          serverReady = true;
          console.log('Ollama server is ready');
          resolve();
        }
      };

      ollamaProcess.stdout.on('data', checkServerReady);
      ollamaProcess.stderr.on('data', checkServerReady);

      ollamaProcess.on('close', (code) => {
        console.log(`Ollama process exited with code ${code}`);
        if (!serverReady) {
          reject(new Error('Ollama server failed to start'));
        }
      });

      ollamaProcess.on('error', (error) => {
        console.error('Failed to start Ollama:', error);
        reject(error);
      });

      // 타임아웃 설정 (30초)
      setTimeout(() => {
        if (!serverReady) {
          ollamaProcess.kill();
          reject(new Error('Ollama server startup timeout'));
        }
      }, 600000);
    });
  }});
}

// qwen2.5-vl-7b 모델이 로드되어 있는지 확인
function checkModelLoaded() {
  return new Promise((resolve) => {
    exec('curl -s http://localhost:11434/api/tags', (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }

      try {
        const response = JSON.parse(stdout);
        const hasModel = response.models && response.models.some(model =>
          model.name.includes('qwen2.5vl:7b')
        );
        resolve(hasModel);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

// qwen2.5vl:7b 모델 다운로드 (spawn 사용으로 버퍼 문제 해결)
function downloadModel() {
  return new Promise((resolve, reject) => {
    console.log('Downloading qwen2.5vl:7b model...');

    const downloadProcess = spawn('ollama', ['pull', 'qwen2.5vl:7b'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let completed = false;

    downloadProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Download stdout:', output);

      // 진행률 파싱 및 전송
      const progressMatch = output.match(/(\d+)%/);
      if (progressMatch) {
        const progress = parseInt(progressMatch[1]);
        mainWindow.webContents.send('download-progress', { progress, message: `다운로드 중... ${progress}%` });
      }

      // 다운로드 단계 표시
      if (output.includes('pulling manifest')) {
        mainWindow.webContents.send('download-progress', { progress: 5, message: '매니페스트 다운로드 중...' });
      } else if (output.includes('pulling') && output.includes('GB')) {
        mainWindow.webContents.send('download-progress', { progress: 30, message: '모델 파일 다운로드 중...' });
      } else if (output.includes('verifying')) {
        mainWindow.webContents.send('download-progress', { progress: 95, message: '파일 검증 중...' });
      }
    });

    downloadProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('Download stderr:', output);

      // 성공 완료 메시지 확인
      if (output.includes('success') || output.includes('complete')) {
        completed = true;
        console.log('Model download completed');
        mainWindow.webContents.send('download-progress', { progress: 100, message: '다운로드 완료!' });
        resolve();
      }

      // 에러 메시지 확인
      if (output.includes('Error:') || output.includes('failed')) {
        console.error('Download error:', output);
        mainWindow.webContents.send('download-progress', { progress: -1, message: '다운로드 실패: ' + output });
        if (!completed) {
          reject(new Error(output));
        }
      }
    });

    downloadProcess.on('close', (code) => {
      console.log(`Download process exited with code ${code}`);
      if (!completed) {
        if (code === 0) {
          // 정상 종료
          console.log('Model download completed successfully');
          mainWindow.webContents.send('download-progress', { progress: 100, message: '다운로드 완료!' });
          resolve();
        } else {
          reject(new Error(`Download process exited with code ${code}`));
        }
      }
    });

    downloadProcess.on('error', (error) => {
      console.error('Download process error:', error);
      reject(error);
    });
  });
}

// Ollama 초기화 (설치 확인 → 설치 → 서버 시작 → 모델 확인 → 다운로드)
async function initializeOllama() {
  try {
    console.log('Initializing Ollama...');

    // 1. Ollama 설치 상태 확인
    const isInstalled = await checkOllamaInstalled();
    if (!isInstalled) {
      console.log('Ollama not found, installing...');
      mainWindow.webContents.send('ollama-status', { status: 'installing', message: 'Ollama 설치 중...' });
      await installOllama();
    }

    // 2. Ollama 서버 시작
    mainWindow.webContents.send('ollama-status', { status: 'starting', message: 'Ollama 서버 시작 중...' });
    await startOllamaServer();

    // 3. 모델 확인 및 다운로드
    const modelLoaded = await checkModelLoaded();
    if (!modelLoaded) {
      console.log('Model not found, downloading...');
      mainWindow.webContents.send('ollama-status', { status: 'downloading', message: 'qwen2.5-vl-7b 모델 다운로드 중...' });
      await downloadModel();
    }

    console.log('Ollama initialization completed');
    mainWindow.webContents.send('ollama-status', { status: 'ready', message: 'Ollama 및 모델 준비 완료' });

  } catch (error) {
    console.error('Ollama initialization failed:', error);
    mainWindow.webContents.send('ollama-status', {
      status: 'error',
      message: `Ollama 초기화 실패: ${error.message}`
    });
  }
}

async function createWindow() {
  // 브라우저 창 생성
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets/icon.png'), // 아이콘 경로 (나중에 추가)
    titleBarStyle: 'default',
    show: false
  });

  // HTML 파일 로드
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // 창이 준비되면 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 개발자 도구 열기 (개발 시에만)
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // 창이 닫힐 때
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // 렌더러가 로드된 후 초기화(이벤트 미수신 방지)
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      await startBackendIfNeeded();
      const installed = await checkOllamaInstalled();
      if (installed) {
        let running = await checkOllamaServerRunning();
        if (!running) {
          await startOllamaServer();
          running = true;
        }
        const modelReady = running ? await checkModelLoaded() : false;
        if (modelReady) {
          mainWindow.webContents.send('ollama-status', { status: 'ready', message: '모두 준비됨' });
        } else {
          mainWindow.webContents.send('ollama-status', { status: 'ready', message: 'Ollama 준비됨 (모델 필요)' });
        }
      } else {
        mainWindow.webContents.send('ollama-status', { status: 'error', message: 'Ollama 설치 필요' });
      }
    } catch (e) {
      console.error('Startup init failed:', e);
      mainWindow.webContents.send('ollama-status', { status: 'error', message: '초기화 실패' });
    }
  });
}

// 개발모드에서만 백엔드 기동 (프로덕션은 번들된 바이너리 사용 가정)
let backendProcess = null;
async function startBackendIfNeeded() {
  console.log('startBackendIfNeeded');
  // 개발 모드에서만 자동 기동
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    console.log('Skipping backend auto-start (NODE_ENV != development)');
    return;
  }
  if (backendProcess) {
    console.log('Backend already running (cached process)');
    return;
  }

  // 후보 실행 경로들 (순서대로 시도)
  const projectRoot = path.join(__dirname, '..');
  const venvPython = path.join(projectRoot, 'backend', 'venv', 'bin', 'python');
  const backendPath = path.join(projectRoot, 'backend', 'main.py');

  const candidates = [];
  // macOS/Linux venv
  candidates.push({ cmd: venvPython, args: [backendPath], label: 'venv python' });
  // 시스템 python3
  candidates.push({ cmd: 'python3', args: [backendPath], label: 'python3' });
  // 시스템 python
  candidates.push({ cmd: 'python', args: [backendPath], label: 'python' });

  let started = false;
  for (const c of candidates) {
    try {
      console.log(`Trying backend start with ${c.label}: ${c.cmd} ${c.args.join(' ')}`);
      backendProcess = spawn(c.cmd, c.args, { stdio: 'ignore', detached: false });
      console.log('Backend started with', c.label);
      started = true;
      break;
    } catch (e) {
      console.error(`Failed with ${c.label}:`, e);
    }
  }

  if (!started) {
    console.error('All backend start attempts failed.');
  }
}

// 앱이 준비되면 창 생성
app.whenReady().then(async () => {
  await createWindow();
});

// 모든 창이 닫혔을 때 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 앱 종료 전에 Ollama 프로세스 정리
app.on('before-quit', () => {
  console.log('Shutting down Ollama...');
  if (ollamaProcess) {
    ollamaProcess.kill();
    ollamaProcess = null;
  }
});

// macOS에서 앱 아이콘 클릭시 창 재생성
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC 통신 핸들러들 (나중에 백엔드와 통신할 때 사용)
ipcMain.handle('get-video-list', async () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 8000,
      path: '/videos',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log('Video list from backend:', response);
          resolve(response.videos || []);
        } catch (error) {
          console.error('Error parsing video list:', error);
          resolve([]);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error fetching video list:', error);
      resolve([]);
    });

    req.end();
  });
});

ipcMain.handle('analyze-video', async (event, videoId) => {
  return new Promise((resolve) => {
    console.log(`Starting video analysis for video ID: ${videoId}`);
    
    const postData = JSON.stringify({});
    
    const options = {
      hostname: '127.0.0.1',
      port: 8000,
      path: `/analyze/${videoId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const result = JSON.parse(data);
            console.log('Video analysis started:', result);
            
            resolve({
              success: true,
              message: result.message || '비디오 분석이 시작되었습니다',
              video_id: videoId,
              status: result.status
            });
          } else {
            console.error(`HTTP error! status: ${res.statusCode}`);
            resolve({
              success: false,
              message: `서버 오류: ${res.statusCode}`
            });
          }
        } catch (error) {
          console.error('Failed to parse analysis response:', error);
          resolve({
            success: false,
            message: '응답 파싱 실패'
          });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Failed to start video analysis:', error);
      resolve({
        success: false,
        message: error.message || '비디오 분석 시작에 실패했습니다'
      });
    });

    req.write(postData);
    req.end();
  });
});

ipcMain.handle('generate-shorts', async (event, videoId) => {
  // TODO: 쇼츠 생성
  console.log('Generate shorts for video:', videoId);
  return { success: true, message: '쇼츠 생성이 시작되었습니다.' };
});

// Ollama 상태 확인 핸들러
ipcMain.handle('check-ollama-status', async () => {
  try {
    const ollamaInstalled = await checkOllamaInstalled();
    let serverRunning = await checkOllamaServerRunning();
    if (!serverRunning) {
      serverRunning = await startOllamaServer();
    }
    const modelReady = serverRunning ? await checkModelLoaded() : false;

    return {
      ollamaInstalled,
      serverRunning,
      modelReady
    };
  } catch (error) {
    console.error('Failed to check Ollama status:', error);
    return {
      ollamaInstalled: false,
      serverRunning: false,
      modelReady: false,
      error: error.message
    };
  }
});

// 모델 상태 확인 핸들러
ipcMain.handle('check-model-status', async () => {
  try {
    const serverRunning = await checkOllamaServerRunning();
    const modelReady = serverRunning ? await checkModelLoaded() : false;

    return { modelReady };
  } catch (error) {
    console.error('Failed to check model status:', error);
    return { modelReady: false, error: error.message };
  }
});

// Ollama 설치 핸들러
ipcMain.handle('install-ollama', async () => {
  try {
    console.log('Installing Ollama...');
    mainWindow.webContents.send('ollama-status', { status: 'installing', message: 'Ollama 설치 중...' });

    const installResult = await installOllama();

    if (!installResult) {
      throw new Error('Ollama installation failed');
    }

    // 설치 성공 후 서버 상태 확인 및 시작
    mainWindow.webContents.send('ollama-status', { status: 'starting', message: 'Ollama 서버 시작 중...' });

    const serverRunning = await checkOllamaServerRunning();
    if (!serverRunning) {
      await startOllamaServer();
    } else {
      console.log('Ollama server is already running');
    }

    mainWindow.webContents.send('ollama-status', { status: 'ready', message: 'Ollama 준비됨' });
    return { success: true };
  } catch (error) {
    console.error('Ollama installation failed:', error);
    mainWindow.webContents.send('ollama-status', { status: 'error', message: 'Ollama 설치 실패' });
    return { success: false, error: error.message };
  }
});

// 모델 다운로드 핸들러
ipcMain.handle('download-model', async () => {
  try {
    console.log('Downloading qwen2.5vl:7b model...');
    mainWindow.webContents.send('ollama-status', { status: 'downloading', message: 'qwen2.5vl:7b 모델 다운로드 중...' });

    await downloadModel();

    mainWindow.webContents.send('ollama-status', { status: 'ready', message: '모델 준비 완료' });
    return { success: true };
  } catch (error) {
    console.error('Model download failed:', error);
    return { success: false, error: error.message };
  }
});
