const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

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
      checkCommand: 'where ollama'
    };
  } else if (platform === 'darwin') {
    // macOS: Desktop 폴더
    return {
      installPath: path.join(homeDir, 'Desktop', 'ollama'),
      exePath: path.join(homeDir, 'Desktop', 'ollama', 'ollama'),
      checkCommand: 'which ollama'
    };
  } else {
    // Linux 등 다른 OS
    return {
      installPath: '/usr/local/bin/ollama',
      exePath: '/usr/local/bin/ollama',
      checkCommand: 'which ollama'
    };
  }
}

// Ollama 설치 상태 확인
function checkOllamaInstalled() {
  return new Promise((resolve) => {
    const paths = getOllamaPaths();

    // 먼저 시스템 PATH에서 확인
    exec(paths.checkCommand, (error, stdout, stderr) => {
      if (!error && stdout.trim()) {
        console.log('Ollama found in PATH:', stdout.trim());
        resolve(true);
        return;
      }

      // 지정된 경로에서 확인
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
        stdio: 'inherit'
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Ollama installation completed on macOS');
          resolve();
        } else {
          reject(new Error(`Ollama installation failed with code ${code}`));
        }
      });

      installProcess.on('error', (error) => {
        reject(error);
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
          resolve();
        } else {
          reject(new Error(`Ollama installation failed with code ${code}`));
        }
      });

      installProcess.on('error', (error) => {
        reject(error);
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
          resolve();
        } else {
          reject(new Error(`Ollama installation failed with code ${code}`));
        }
      });

      installProcess.on('error', (error) => {
        reject(error);
      });
    }
  });
}

// Ollama 서버 시작
function startOllamaServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting Ollama server...');

    const paths = getOllamaPaths();

    // PATH에 있는 ollama 우선 사용, 없으면 지정된 경로 사용
    exec('which ollama', (error, stdout) => {
      const ollamaCmd = error ? paths.exePath : 'ollama';

      ollamaProcess = spawn(ollamaCmd, ['serve'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
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
      }, 30000);
    });
  });
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
          model.name.includes('qwen2.5-vl-7b')
        );
        resolve(hasModel);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

// qwen2.5-vl-7b 모델 다운로드
function downloadModel() {
  return new Promise((resolve, reject) => {
    console.log('Downloading qwen2.5-vl-7b model...');

    const downloadProcess = exec('ollama pull qwen2.5-vl-7b', (error, stdout, stderr) => {
      if (error) {
        console.error('Model download failed:', error);
        reject(error);
        return;
      }

      console.log('Model download completed');
      resolve();
    });

    downloadProcess.stdout.on('data', (data) => {
      console.log('Download progress:', data.toString());
    });

    downloadProcess.stderr.on('data', (data) => {
      console.log('Download stderr:', data.toString());
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

function createWindow() {
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
}

// 앱이 준비되면 창 생성
app.whenReady().then(() => {
  createWindow();
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
ipcMain.handle('upload-video', async (event, filePath) => {
  // TODO: 비디오 업로드 처리
  console.log('Upload video:', filePath);
  return { success: true, message: '비디오가 업로드되었습니다.' };
});

ipcMain.handle('get-video-list', async () => {
  // TODO: 비디오 목록 가져오기
  return [];
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
    const serverRunning = await checkOllamaServerRunning();
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

    await installOllama();

    // 서버가 이미 실행 중인지 확인
    const serverRunning = await checkOllamaServerRunning();
    if (!serverRunning) {
      mainWindow.webContents.send('ollama-status', { status: 'starting', message: 'Ollama 서버 시작 중...' });
      await startOllamaServer();
    } else {
      console.log('Ollama server is already running, skipping start');
      mainWindow.webContents.send('ollama-status', { status: 'ready', message: 'Ollama 준비됨' });
    }

    return { success: true };
  } catch (error) {
    console.error('Ollama installation failed:', error);
    return { success: false, error: error.message };
  }
});

// 모델 다운로드 핸들러
ipcMain.handle('download-model', async () => {
  try {
    console.log('Downloading qwen2.5-vl-7b model...');
    mainWindow.webContents.send('ollama-status', { status: 'downloading', message: 'qwen2.5-vl-7b 모델 다운로드 중...' });

    await downloadModel();

    mainWindow.webContents.send('ollama-status', { status: 'ready', message: '모델 준비 완료' });
    return { success: true };
  } catch (error) {
    console.error('Model download failed:', error);
    return { success: false, error: error.message };
  }
});
