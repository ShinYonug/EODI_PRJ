from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import moviepy as mp
import cv2
import uvicorn
import os
import uuid
import shutil
import base64
import numpy as np
import psutil
import requests
import asyncio
import aiofiles
from datetime import datetime
from typing import List, Dict, Any
import json
import logging
from collections import OrderedDict
import gc
import math
import subprocess
import concurrent.futures
from threading import Thread
import queue
import time

# Ollama 성능 최적화 환경변수 설정 (크로스 플랫폼)
def setup_ollama_environment():
    """플랫폼별 Ollama 환경변수 설정"""
    import platform
    system = platform.system().lower()
    
    # 공통 설정
    os.environ['OLLAMA_NUM_PARALLEL'] = '1'  # 단일 모델 전용
    os.environ['OLLAMA_MAX_LOADED_MODELS'] = '1'  # 단일 모델 집중
    os.environ['OLLAMA_FLASH_ATTENTION'] = '1'
    os.environ['OLLAMA_KEEP_ALIVE'] = '15m'  # 모델 유지 시간
    os.environ['OLLAMA_GPU_LAYERS'] = '99'  # 모든 레이어를 GPU에서 처리
    os.environ['OLLAMA_LOAD_TIMEOUT'] = '300'  # 로드 타임아웃 증가
    os.environ['OLLAMA_MAX_QUEUE'] = '5'  # 단일 모델 최적화 대기열
    os.environ['OLLAMA_CONTEXT_LENGTH'] = '8192'  # 컨텍스트 길이 설정
    
    if system == 'darwin':  # macOS (M4 Max 최적화)
        os.environ['OLLAMA_NUM_GPU'] = '36'  # M4 Max 90% GPU 사용
        os.environ['OLLAMA_GPU_MEMORY_FRACTION'] = '0.9'  # 통합 메모리 90% 활용
        # logger.info("macOS M4 Max Ollama 환경변수 설정 완료")
        
    elif system == 'windows':  # Windows
        os.environ['OLLAMA_NUM_GPU'] = '-1'  # 자동 GPU 감지
        os.environ['OLLAMA_GPU_MEMORY_FRACTION'] = '0.8'  # Windows GPU 메모리 80%
        # logger.info("Windows Ollama 환경변수 설정 완료")
        
    elif system == 'linux':  # Linux
        os.environ['OLLAMA_NUM_GPU'] = '-1'  # 자동 GPU 감지
        os.environ['OLLAMA_GPU_MEMORY_FRACTION'] = '0.8'  # Linux GPU 메모리 80%
        # logger.info("Linux Ollama 환경변수 설정 완료")

# Ollama 환경변수 설정 실행
setup_ollama_environment()

# 디렉토리 설정
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 분석 결과 저장 디렉토리
ANALYSIS_DIR = "analysis_results"
os.makedirs(ANALYSIS_DIR, exist_ok=True)

# 쇼츠 저장 디렉토리
SHORTS_DIR = "shorts"
os.makedirs(SHORTS_DIR, exist_ok=True)

# 청크 업로드 임시 디렉토리
TEMP_DIR = "temp"
os.makedirs(TEMP_DIR, exist_ok=True)

# 디렉토리 설정
UPLOAD_DIR = "uploads"
THUMBNAILS_DIR = "thumbnails"

def clear_directories():
    """업로드 및 썸네일 디렉토리 초기화"""
    print("Clearing upload and thumbnail directories...")
    
    # uploads 폴더 비우기
    if os.path.exists(UPLOAD_DIR):
        for file in os.listdir(UPLOAD_DIR):
            file_path = os.path.join(UPLOAD_DIR, file)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
                    print(f"Removed upload file: {file}")
            except Exception as e:
                print(f"Error removing file {file}: {str(e)}")
    
    # thumbnails 폴더 비우기
    if os.path.exists(THUMBNAILS_DIR):
        for file in os.listdir(THUMBNAILS_DIR):
            file_path = os.path.join(THUMBNAILS_DIR, file)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
                    print(f"Removed thumbnail: {file}")
            except Exception as e:
                print(f"Error removing thumbnail {file}: {str(e)}")

    # 디렉토리 재생성
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(THUMBNAILS_DIR, exist_ok=True)
    print("Directories cleared and recreated.")

# 서버 시작 시 디렉토리 초기화
clear_directories()

# FastAPI 앱 생성
app = FastAPI(
    title="EODI Video Analysis API",
    description="비디오 분석 및 쇼츠 생성을 위한 API",
    version="1.0.0"
)

# 정적 파일 마운트 (썸네일 제공용)
app.mount("/thumbnails", StaticFiles(directory=THUMBNAILS_DIR), name="thumbnails")

# CORS 설정 (Electron 앱과의 통신을 위해)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 실제 배포시 특정 origin으로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 업로드 디렉토리 설정
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 분석 결과 저장 디렉토리
ANALYSIS_DIR = "analysis_results"
os.makedirs(ANALYSIS_DIR, exist_ok=True)

# 쇼츠 저장 디렉토리
SHORTS_DIR = "shorts"
os.makedirs(SHORTS_DIR, exist_ok=True)

# 청크 업로드 임시 디렉토리
TEMP_DIR = "temp"
os.makedirs(TEMP_DIR, exist_ok=True)

# 썸네일 저장 디렉토리
THUMBNAILS_DIR = "thumbnails"
os.makedirs(THUMBNAILS_DIR, exist_ok=True)

# 비디오 메타데이터 저장 (간단한 인메모리 저장소 - 실제로는 데이터베이스 사용 권장)
videos_db = []

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 결과 저장 디렉토리
RESULTS_DIR = "temp"
os.makedirs(RESULTS_DIR, exist_ok=True)

class BatchSizeManager:
    """동적 배치 크기 관리"""
    def __init__(self, min_batch=2, max_batch=8, target_memory_usage=0.8):
        self.min_batch = min_batch
        self.max_batch = max_batch
        self.target_memory_usage = target_memory_usage
        self.current_batch_size = 4  # GPU 가속을 고려한 기본값
        
    def get_optimal_batch_size(self):
        """시스템 리소스 기반 최적 배치 크기 계산"""
        try:
            memory = psutil.virtual_memory()
            available_memory_gb = memory.available / (1024**3)
            
            # M4 Max 통합 메모리 최적화된 배치 크기 계산
            if available_memory_gb > 20:
                optimal_batch = 12  # M4 Max 고성능 (통합 메모리 최적화)
            elif available_memory_gb > 15:
                optimal_batch = 10  # 높은 성능
            elif available_memory_gb > 10:
                optimal_batch = 8   # 중고성능
            elif available_memory_gb > 5:
                optimal_batch = 6   # 중성능
            else:
                optimal_batch = 4   # 안정성 우선
                
            self.current_batch_size = min(
                max(self.min_batch, optimal_batch),
                self.max_batch
            )
            
            logger.info(f"Available memory: {available_memory_gb:.1f}GB, Batch size: {self.current_batch_size}")
            return self.current_batch_size
            
        except Exception as e:
            logger.warning(f"메모리 확인 실패, 기본 배치 크기 사용: {e}")
            return self.current_batch_size

class OptimizedFrameExtractor:
    """M4 Max 최적화된 고속 프레임 추출기"""
    
    def __init__(self, target_size=(640, 360)):
        self.target_size = target_size
        self.max_workers = 4  # CPU 코어 활용
        self.platform = os.name
    
    def _get_hwaccel_args(self):
        """OS별 FFmpeg 하드웨어 가속 인수 반환"""
        import platform
        system = platform.system().lower()
        
        if system == 'darwin':  # macOS
            return ['-hwaccel', 'videotoolbox']
        elif system == 'windows':  # Windows
            # NVIDIA GPU가 있는 경우 NVENC 사용
            try:
                # GPU 확인 (간단한 방법)
                result = subprocess.run(['nvidia-smi'], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    logger.info("NVIDIA GPU 감지, NVENC 하드웨어 가속 사용")
                    return ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']
            except:
                pass
            
            # DirectX Video Acceleration (DXVA2) 사용 (Intel/AMD GPU)
            logger.info("Windows DXVA2 하드웨어 가속 사용")
            return ['-hwaccel', 'dxva2']
            
        elif system == 'linux':  # Linux
            # VAAPI (Intel/AMD) 또는 VDPAU (NVIDIA) 사용
            try:
                # NVIDIA GPU 확인
                result = subprocess.run(['nvidia-smi'], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    logger.info("Linux NVIDIA GPU 감지, CUDA 하드웨어 가속 사용")
                    return ['-hwaccel', 'cuda']
            except:
                pass
            
            logger.info("Linux VAAPI 하드웨어 가속 사용")
            return ['-hwaccel', 'vaapi']
        
        # 기본값: 소프트웨어 디코딩
        logger.info("하드웨어 가속 미지원, 소프트웨어 디코딩 사용")
        return []
    
    def _get_opencv_backend(self):
        """OS별 OpenCV 백엔드 반환"""
        import platform
        system = platform.system().lower()
        
        if system == 'darwin':  # macOS
            return cv2.CAP_AVFOUNDATION
        elif system == 'windows':  # Windows
            return cv2.CAP_DSHOW  # DirectShow
        elif system == 'linux':  # Linux
            return cv2.CAP_V4L2   # Video4Linux2
        else:
            return cv2.CAP_ANY    # 기본값
        
    def extract_frames_ffmpeg_hardware(self, video_path, interval_seconds=1):
        """FFmpeg 하드웨어 가속으로 프레임 추출 (크로스 플랫폼)"""
        try:
            # OS별 하드웨어 가속 설정
            hwaccel_args = self._get_hwaccel_args()
            
            cmd = [
                'ffmpeg',
                *hwaccel_args,  # OS별 하드웨어 가속
                '-i', video_path,
                '-vf', f'fps=1/{interval_seconds},scale={self.target_size[0]}:{self.target_size[1]}',
                '-f', 'image2pipe',
                '-pix_fmt', 'rgb24',
                '-vcodec', 'rawvideo',
                '-loglevel', 'quiet',  # 로그 최소화
                '-'
            ]
            
            logger.info(f"FFmpeg 하드웨어 가속 프레임 추출 시작: {video_path}")
            start_time = time.time()
            
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            frames_data = []
            frame_count = 0
            
            # 프레임 크기 계산
            frame_size = self.target_size[0] * self.target_size[1] * 3  # RGB
            
            while True:
                # 프레임 데이터 읽기
                raw_frame = process.stdout.read(frame_size)
                if len(raw_frame) != frame_size:
                    break
                    
                # numpy 배열로 변환
                frame = np.frombuffer(raw_frame, dtype=np.uint8)
                frame = frame.reshape((self.target_size[1], self.target_size[0], 3))
                
                # BGR로 변환 (OpenCV 호환)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                
                timestamp = frame_count * interval_seconds
                frames_data.append({
                    'frame': frame_bgr,
                    'timestamp': timestamp
                })
                frame_count += 1
            
            process.wait()
            extraction_time = time.time() - start_time
            logger.info(f"FFmpeg 추출 완료: {frame_count}개 프레임, {extraction_time:.2f}초")
            
            return frames_data
            
        except Exception as e:
            logger.warning(f"FFmpeg 하드웨어 가속 실패, OpenCV로 폴백: {e}")
            return self.extract_frames_opencv_optimized(video_path, interval_seconds)
    
    def extract_frames_opencv_optimized(self, video_path, interval_seconds=1):
        """OpenCV 최적화 프레임 추출 (크로스 플랫폼 폴백)"""
        logger.info(f"OpenCV 최적화 프레임 추출 시작: {video_path}")
        start_time = time.time()
        
        # OS별 OpenCV 백엔드 설정
        backend = self._get_opencv_backend()
        cap = cv2.VideoCapture(video_path, backend)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # 버퍼 최소화
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_interval = max(1, int(fps * interval_seconds))
        
        frames_data = []
        
        # 필요한 프레임만 직접 점프하여 추출
        for frame_num in range(0, total_frames, frame_interval):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            ret, frame = cap.read()
            
            if ret:
                # 추출과 동시에 리사이징
                frame_resized = cv2.resize(frame, self.target_size, 
                                         interpolation=cv2.INTER_LINEAR)
                
                timestamp = frame_num / fps
                frames_data.append({
                    'frame': frame_resized,
                    'timestamp': timestamp
                })
        
        cap.release()
        extraction_time = time.time() - start_time
        logger.info(f"OpenCV 추출 완료: {len(frames_data)}개 프레임, {extraction_time:.2f}초")
        
        return frames_data
    
    def extract_frames_parallel(self, video_path, timestamps):
        """멀티스레딩으로 특정 타임스탬프 프레임들 병렬 추출"""
        logger.info(f"병렬 프레임 추출 시작: {len(timestamps)}개 타임스탬프")
        start_time = time.time()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [
                executor.submit(self._extract_single_frame, video_path, timestamp) 
                for timestamp in timestamps
            ]
            
            frames_data = []
            for i, future in enumerate(concurrent.futures.as_completed(futures)):
                try:
                    frame_data = future.result()
                    if frame_data:
                        frames_data.append(frame_data)
                except Exception as e:
                    logger.error(f"프레임 추출 실패 (timestamp {timestamps[i]}): {e}")
        
        # 타임스탬프 순으로 정렬
        frames_data.sort(key=lambda x: x['timestamp'])
        
        extraction_time = time.time() - start_time
        logger.info(f"병렬 추출 완료: {len(frames_data)}개 프레임, {extraction_time:.2f}초")
        
        return frames_data
    
    def _extract_single_frame(self, video_path, timestamp):
        """단일 프레임 추출 (스레드용)"""
        try:
            cap = cv2.VideoCapture(video_path)
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ret, frame = cap.read()
            cap.release()
            
            if ret:
                frame_resized = cv2.resize(frame, self.target_size, 
                                         interpolation=cv2.INTER_LINEAR)
                return {
                    'frame': frame_resized,
                    'timestamp': timestamp
                }
        except Exception as e:
            logger.error(f"단일 프레임 추출 실패 (timestamp {timestamp}): {e}")
        
        return None

class SceneAnalyzer:
    """장면 분석기 - 최적화된 프레임 추출 통합"""
    def __init__(self, scene_threshold=0.65):
        self.scene_threshold = scene_threshold
        self.frame_extractor = OptimizedFrameExtractor(target_size=(640, 360))  # 최적화된 추출기
        # 단일 Ollama 서버 URL
        self.ollama_url = "http://127.0.0.1:11434/api/generate"
        self.interval_seconds = 1.0
        self.video_duration = 0.0
        
    def get_ollama_url(self):
        """단일 Ollama 서버 URL 반환"""
        return self.ollama_url
        
    async def extract_frames_from_video(self, video_path, interval_seconds=2):
        """최적화된 프레임 추출 (FFmpeg 하드웨어 가속 우선)"""
        try:
            # 비디오 메타데이터 먼저 가져오기
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = total_frames / fps
            cap.release()
            
            # 메타데이터 저장
            self.interval_seconds = float(interval_seconds)
            self.video_duration = float(duration)
            
            logger.info(f"비디오 정보: FPS={fps}, 총 프레임={total_frames}, 길이={duration:.1f}초")
            logger.info("🚀 최적화된 프레임 추출 시작 (FFmpeg 하드웨어 가속 우선)")
            
            # FFmpeg 하드웨어 가속으로 프레임 추출 시도
            raw_frames = self.frame_extractor.extract_frames_ffmpeg_hardware(
                video_path, interval_seconds
            )
            
            # Base64 인코딩 (Ollama 전송용)
            frames_data = []
            for frame_data in raw_frames:
                frame = frame_data['frame']
                timestamp = frame_data['timestamp']
                
                # JPEG 품질 최적화 (70 품질로 속도와 품질 균형)
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                img_base64 = base64.b64encode(buffer).decode('utf-8')
                
                frames_data.append({
                    'timestamp': timestamp,
                    'frame_index': int(timestamp * fps),
                    'image_base64': img_base64
                })
                
                if len(frames_data) % 10 == 0:  # 10개마다 로그
                    logger.info(f"프레임 인코딩 진행: {len(frames_data)}개 완료")
            
            logger.info(f"🎯 최적화된 프레임 추출 완료: {len(frames_data)}개 프레임")
            return frames_data
            
        except Exception as e:
            logger.error(f"최적화된 프레임 추출 실패: {e}")
            return []
    
    def detect_scene_changes(self, frames_data):
        """개선된 장면 전환 감지 - 구도 변화 vs 실제 장면 변화 구분"""
        scene_changes = [0]  # 첫 번째 프레임은 항상 새로운 장면
        
        try:
            prev_hist = None
            prev_frame = None
            consecutive_changes = 0  # 연속 변화 카운터
            
            for i, frame_data in enumerate(frames_data):
                # base64에서 이미지 복원
                img_data = base64.b64decode(frame_data['image_base64'])
                nparr = np.frombuffer(img_data, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                
                if prev_hist is not None and prev_frame is not None:
                    # 1. 히스토그램 비교 (색상 분포)
                    hist = cv2.calcHist([frame], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
                    color_correlation = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
                    
                    # 2. 구조적 유사도 비교 (SSIM - 구도/형태 변화)
                    gray_current = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    gray_prev = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
                    
                    # 간단한 구조적 유사도 계산 (SSIM 대신 템플릿 매칭 사용)
                    result = cv2.matchTemplate(gray_current, gray_prev, cv2.TM_CCOEFF_NORMED)
                    structural_similarity = np.max(result)
                    
                    # 3. 복합 판단 기준
                    is_scene_change = False
                    
                    # 색상과 구조 모두 크게 변한 경우 (실제 장면 전환)
                    if color_correlation < self.scene_threshold and structural_similarity < 0.5:
                        is_scene_change = True
                        change_reason = "색상+구조 변화"
                    
                    # 색상은 유사하지만 구조가 크게 변한 경우 (카메라 앵글 변화)
                    elif color_correlation > 0.8 and structural_similarity < 0.3:
                        is_scene_change = True
                        change_reason = "구조적 변화"
                    
                    # 색상이 크게 변했지만 구조는 유사한 경우 (조명 변화 - 장면 전환 아님)
                    elif color_correlation < 0.5 and structural_similarity > 0.7:
                        is_scene_change = False
                        change_reason = "조명 변화 (무시)"
                    
                    # 연속적인 작은 변화 감지 (점진적 장면 전환)
                    if color_correlation < 0.75:
                        consecutive_changes += 1
                    else:
                        consecutive_changes = 0
                    
                    # 연속 3회 이상 변화 시 장면 전환으로 판단
                    if consecutive_changes >= 3:
                        is_scene_change = True
                        change_reason = "점진적 변화"
                        consecutive_changes = 0
                    
                    if is_scene_change:
                        scene_changes.append(i)
                        logger.info(f"장면 전환 감지: {frame_data['timestamp']:.1f}초 - {change_reason} "
                                  f"(색상: {color_correlation:.3f}, 구조: {structural_similarity:.3f})")
                    else:
                        logger.debug(f"장면 유지: {frame_data['timestamp']:.1f}초 - {change_reason} "
                                   f"(색상: {color_correlation:.3f}, 구조: {structural_similarity:.3f})")
                
                # 히스토그램 계산 (다음 비교용)
                hist = cv2.calcHist([frame], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
                prev_hist = hist
                prev_frame = frame.copy()
            
            return scene_changes
            
        except Exception as e:
            logger.error(f"장면 전환 감지 중 오류: {e}")
            return [0]
    
    def group_frames_by_scene(self, frames_data, scene_changes):
        """프레임을 장면별로 그룹화"""
        scenes = []
        
        for i in range(len(scene_changes)):
            start_idx = scene_changes[i]
            end_idx = scene_changes[i + 1] if i + 1 < len(scene_changes) else len(frames_data)
            
            scene_frames = frames_data[start_idx:end_idx]
            if scene_frames:
                scenes.append({
                    'scene_id': i + 1,
                    'start_time': scene_frames[0]['timestamp'],
                    'end_time': scene_frames[-1]['timestamp'],
                    'frames': scene_frames
                })
        
        logger.info(f"총 {len(scenes)}개 장면으로 분할")
        return scenes
    
    async def analyze_scene_batch(self, scene_frames, scene_id, start_time, end_time):
        """장면의 배치 분석"""
        try:
            # 대표 프레임 선택 (최대 3개)
            representative_frames = self.select_representative_frames(scene_frames)
            
            # 더 복잡한 GPU 집약적 분석 프롬프트
            prompt = f"""
장면 {scene_id} 종합 분석 ({start_time:.1f}초 ~ {end_time:.1f}초):

이 장면의 모든 프레임을 매우 상세하게 분석해주세요. 다음 모든 항목을 포함한 JSON으로 응답해주세요:

{{
    "scene_description": "장면의 매우 상세한 설명 (최소 100자)",
    "visual_elements": {{
        "objects": ["식별된 모든 객체들"],
        "colors": ["주요 색상들과 색조 분석"],
        "lighting": "조명 상태와 그림자 분석",
        "composition": "화면 구성과 레이아웃 분석"
    }},
    "mood": "주요 분위기 (happy/sad/excited/calm/tense/peaceful/dramatic/mysterious 중 하나)",
    "emotion_intensity": 0.0~1.0 사이의 감정 강도,
    "situation": "상황에 대한 상세한 설명",
    "key_events": ["장면에서 일어나는 모든 주요 사건들"],
    "character_analysis": {{
        "people_count": "등장인물 수",
        "expressions": ["표정 분석"],
        "actions": ["행동 분석"],
        "interactions": ["상호작용 분석"]
    }},
    "technical_analysis": {{
        "camera_movement": "카메라 움직임 분석",
        "shot_type": "샷의 종류 (클로즈업, 롱샷 등)",
        "focus_area": "초점이 맞춰진 영역"
    }},
    "highlight_score": 0.0~1.0 사이의 하이라이트 점수,
    "mood_progression": "장면 내 분위기 변화의 상세 분석",
    "narrative_importance": "스토리텔링 관점에서의 중요도 분석"
}}

모든 프레임의 연속성, 시각적 요소, 감정적 흐름을 종합적으로 고려하여 매우 상세하게 분석해주세요.
"""
            
            # 이미지들을 Ollama에 전송
            images = [frame['image_base64'] for frame in representative_frames]
            
            response = await self.call_ollama_api(prompt, images)
            
            if response:
                return self.parse_analysis_response(response, scene_id, start_time, end_time)
            else:
                return self.create_fallback_analysis(scene_id, start_time, end_time)
                
        except Exception as e:
            logger.error(f"장면 {scene_id} 분석 중 오류: {e}")
            return self.create_fallback_analysis(scene_id, start_time, end_time)
    
    def select_representative_frames(self, scene_frames):
        """장면의 대표 프레임 선택"""
        if len(scene_frames) <= 3:
            return scene_frames
        
        # 적절한 대표 프레임 선택 (안정성과 성능 균형)
        frame_count = min(3, len(scene_frames))  # 최대 3개 프레임 (안정성)
        indices = []
        
        for i in range(frame_count):
            idx = int(i * (len(scene_frames) - 1) / (frame_count - 1))
            indices.append(idx)
        
        return [scene_frames[i] for i in indices]
    
    async def call_ollama_api(self, prompt, images):
        """Ollama API 호출"""
        try:
            payload = {
                "model": "qwen2.5vl:7b",
                "prompt": prompt,
                "images": images,
                "stream": False,
                "keep_alive": "10m",  # 모델을 10분간 메모리에 유지
                "options": {
                    "temperature": 0.3,
                    "top_p": 0.9,
                    "num_gpu": 36,  # 90% GPU 활용률 목표 (40코어 * 0.9)
                    "num_thread": 10,  # CPU 스레드 적절히 조정
                    "num_ctx": 7168,   # 컨텍스트 크기 90% 활용
                    "num_batch": 896,  # 배치 크기 90% 활용
                    "num_predict": 360, # 예측 토큰 90% 활용
                    "repeat_penalty": 1.1,
                    "top_k": 40,
                    "num_keep": 4,  # 더 많은 토큰 유지
                    "tfs_z": 1.0,  # 추가 샘플링 파라미터
                    "typical_p": 1.0  # 추가 처리 부하
                }
            }
            
            logger.info("Ollama API 호출 중...")
            
            async with asyncio.timeout(60):  # 60초 타임아웃 (복잡한 분석용)
                # 비동기 HTTP 요청을 위해 별도 스레드에서 실행
                loop = asyncio.get_event_loop()
                # 단일 서버 URL 사용
                ollama_url = self.get_ollama_url()
                response = await loop.run_in_executor(
                    None,  # 기본 ThreadPoolExecutor 사용
                    lambda: requests.post(
                        ollama_url,
                        json=payload,
                        timeout=60
                    )
                )
                
                if response.status_code == 200:
                    result = response.json()
                    response_text = result.get('response', '')
                    logger.info(f"Ollama 분석 완료 - 응답 길이: {len(response_text)}")
                    if not response_text:
                        logger.warning("Ollama 응답이 비어있음")
                    return response_text
                else:
                    logger.error(f"Ollama API HTTP 오류: {response.status_code}, 응답: {response.text[:200]}")
                    return None
                    
        except asyncio.TimeoutError:
            logger.error(f"Ollama API 타임아웃 (60초 초과): {ollama_url}")
            return None
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Ollama 서버 연결 실패: {ollama_url} - 서버가 실행 중인지 확인하세요")
            return None
        except Exception as e:
            logger.error(f"Ollama API 호출 실패 - URL: {ollama_url}, 오류: {str(e)}, 타입: {type(e)}")
            return None
    
    def parse_analysis_response(self, response_text, scene_id, start_time, end_time):
        """Ollama 응답 파싱 - 중첩 JSON 구조 해결"""
        try:
            logger.info(f"장면 {scene_id} 응답 파싱 시작 - 길이: {len(response_text) if response_text else 0}")
            
            if not response_text:
                logger.error(f"장면 {scene_id}: 빈 응답")
                return self.create_fallback_analysis(scene_id, start_time, end_time)
            
            # 다양한 JSON 추출 방법 시도
            analysis = None
            
            # 방법 1: 표준 JSON 블록 추출
            if '{' in response_text and '}' in response_text:
                try:
                    start = response_text.find('{')
                    end = response_text.rfind('}') + 1
                    json_str = response_text[start:end]
                    analysis = json.loads(json_str)
                    logger.info(f"장면 {scene_id}: 표준 JSON 파싱 성공")
                except json.JSONDecodeError as e:
                    logger.warning(f"장면 {scene_id}: 표준 JSON 파싱 실패 - {e}")
            
            # 방법 2: 중첩된 JSON 문자열 처리
            if not analysis and 'scene_description' in response_text:
                try:
                    # scene_description이 JSON 문자열인 경우 처리
                    import re
                    nested_json_match = re.search(r'"scene_description":\s*"({.*?})"', response_text, re.DOTALL)
                    if nested_json_match:
                        nested_json_str = nested_json_match.group(1).replace('\n', '').replace('\\', '')
                        analysis = json.loads(nested_json_str)
                        logger.info(f"장면 {scene_id}: 중첩 JSON 파싱 성공")
                except Exception as e:
                    logger.warning(f"장면 {scene_id}: 중첩 JSON 파싱 실패 - {e}")
            
            # 방법 3: 부분 정보 추출
            if not analysis:
                try:
                    # 기본 구조로 안전하게 파싱
                    analysis = {
                        "scene_description": self._extract_description(response_text),
                        "mood": self._extract_field(response_text, "mood", "neutral"),
                        "emotion_intensity": float(self._extract_field(response_text, "emotion_intensity", "0.5")),
                        "situation": self._extract_field(response_text, "situation", "일반적인 상황"),
                        "key_events": [],
                        "highlight_score": float(self._extract_field(response_text, "highlight_score", "0.5")),
                        "mood_progression": self._extract_field(response_text, "mood_progression", "안정적")
                    }
                    logger.info(f"장면 {scene_id}: 부분 정보 추출 성공")
                except Exception as e:
                    logger.warning(f"장면 {scene_id}: 부분 정보 추출 실패 - {e}")
            
            # 최종 검증 및 정리
            if analysis:
                # scene_description이 JSON 문자열인 경우 실제 설명만 추출
                if isinstance(analysis.get('scene_description'), str):
                    desc = analysis['scene_description']
                    if desc.startswith('{') and desc.endswith('}'):
                        try:
                            nested = json.loads(desc)
                            if 'scene_description' in nested:
                                analysis['scene_description'] = nested['scene_description']
                        except:
                            # JSON 파싱 실패 시 첫 200자만 사용
                            analysis['scene_description'] = desc[:200] + "..." if len(desc) > 200 else desc
                
                # 메타데이터 추가
                analysis.update({
                    "scene_id": scene_id,
                    "time_range": {
                        "start": int(start_time),
                        "end": int(end_time),
                        "duration": int(end_time - start_time)
                    },
                    "timestamp": datetime.now().isoformat()
                })
                
                logger.info(f"장면 {scene_id}: 파싱 완료 - {analysis['mood']}")
                return analysis
            
            # 모든 방법 실패 시 폴백
            logger.error(f"장면 {scene_id}: 모든 파싱 방법 실패")
            return self.create_fallback_analysis(scene_id, start_time, end_time)
            
        except Exception as e:
            logger.error(f"장면 {scene_id} 파싱 중 예외 발생: {str(e)}")
            if response_text:
                logger.error(f"응답 내용 샘플: {response_text[:100]}...")
            return self.create_fallback_analysis(scene_id, start_time, end_time)
    
    def _extract_description(self, text):
        """텍스트에서 장면 설명 추출"""
        # JSON 내부의 scene_description 찾기
        import re
        desc_match = re.search(r'"scene_description":\s*"([^"]*)"', text)
        if desc_match:
            return desc_match.group(1)
        
        # 일반 텍스트에서 의미있는 부분 추출
        if len(text) > 200:
            return text[:200] + "..."
        return text
    
    def _extract_field(self, text, field_name, default_value):
        """텍스트에서 특정 필드 값 추출"""
        import re
        pattern = rf'"{field_name}":\s*"?([^",\}}]*)"?'
        match = re.search(pattern, text)
        if match:
            value = match.group(1).strip('"')
            return value if value else default_value
        return default_value
    
    def create_fallback_analysis(self, scene_id, start_time, end_time):
        """분석 실패 시 기본 응답 생성"""
        return {
            "scene_id": scene_id,
            "scene_description": f"장면 {scene_id} - 분석 실패",
            "mood": "unknown",
            "emotion_intensity": 0.0,
            "situation": "분석 불가",
            "key_events": [],
            "highlight_score": 0.0,
            "mood_progression": "알 수 없음",
            "time_range": {
                "start": start_time,
                "end": end_time,
                "duration": end_time - start_time
            },
            "timestamp": datetime.now().isoformat(),
            "error": True
        }

def extract_video_metadata(file_path):
    """비디오 메타데이터(길이, 썸네일) 추출"""
    try:
        # 비디오 길이 추출
        video = mp.VideoFileClip(file_path)
        duration = int(video.duration)
        video.close()

        # 썸네일 생성 (첫 프레임)
        cap = cv2.VideoCapture(file_path)
        ret, frame = cap.read()
        
        thumbnail_path = None
        if ret:
            thumbnail_filename = f"thumb_{os.path.basename(file_path)}.jpg"
            thumbnail_path = os.path.join(THUMBNAILS_DIR, thumbnail_filename)
            cv2.imwrite(thumbnail_path, frame)
            # 상대 경로로 변환
            thumbnail_path = f"/thumbnails/{thumbnail_filename}"
            
        cap.release()

        return {
            "duration": format_duration(duration),
            "thumbnail": thumbnail_path
        }
    except Exception as e:
        print(f"Error extracting metadata: {e}")
        return {"duration": "00:00", "thumbnail": None}

def format_duration(seconds):
    """초를 HH:MM:SS 형식으로 변환"""
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"

# 청크 업로드용 임시 저장소
chunk_uploads = {}

@app.get("/")
async def root():
    """API 상태 확인"""
    return {
        "message": "EODI Video Analysis API",
        "status": "running",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """헬스 체크"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.post("/upload/init")
async def init_upload(request: dict):
    """
    청크 업로드 초기화
    """
    filename = request.get("filename")
    file_size = request.get("fileSize")
    total_chunks = request.get("totalChunks")

    if not filename or not file_size or not total_chunks:
        raise HTTPException(status_code=400, detail="필수 파라미터가 누락되었습니다")

    # 확장자 검증 (파일명과 무관하게 확장자만 체크)
    allowed_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm']
    file_extension = '.' + filename.lower().split('.')[-1]
    if file_extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다")

    # 파일 크기 제한 (2GB)
    max_size = 2 * 1024 * 1024 * 1024  # 2GB
    if file_size > max_size:
        raise HTTPException(status_code=400, detail="파일 크기가 2GB를 초과합니다")

    # 고유 업로드 ID 생성
    upload_id = str(uuid.uuid4())

    # 임시 저장 정보 초기화
    chunk_uploads[upload_id] = {
        "filename": filename,
        "file_size": file_size,
        "total_chunks": total_chunks,
        "uploaded_chunks": [],
        "temp_path": os.path.join(TEMP_DIR, f"{upload_id}.tmp"),
        "created_at": datetime.now()
    }

    return {"uploadId": upload_id}

@app.post("/upload/chunk")
async def upload_chunk(
    uploadId: str = Form(...),
    chunkIndex: int = Form(...),
    totalChunks: int = Form(...),
    chunk: UploadFile = File(...)
):
    """
    파일 청크 업로드
    """
    if uploadId not in chunk_uploads:
        raise HTTPException(status_code=400, detail="잘못된 업로드 ID입니다")

    upload_info = chunk_uploads[uploadId]

    # 청크 인덱스 검증
    if chunkIndex >= totalChunks or chunkIndex in upload_info["uploaded_chunks"]:
        raise HTTPException(status_code=400, detail="잘못된 청크 인덱스입니다")

    # 청크 데이터 읽기
    chunk_data = await chunk.read()

    try:
        # 임시 파일에 청크 추가
        with open(upload_info["temp_path"], "ab") as temp_file:
            temp_file.write(chunk_data)

        # 업로드된 청크 기록
        upload_info["uploaded_chunks"].append(chunkIndex)

        return {"success": True, "chunkIndex": chunkIndex}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"청크 저장 중 오류 발생: {str(e)}")

@app.post("/upload/complete")
async def complete_upload(request: dict):
    """
    청크 업로드 완료
    """
    upload_id = request.get("uploadId")

    if not upload_id or upload_id not in chunk_uploads:
        raise HTTPException(status_code=400, detail="잘못된 업로드 ID입니다")

    upload_info = chunk_uploads[upload_id]

    # 모든 청크가 업로드되었는지 확인
    if len(upload_info["uploaded_chunks"]) != upload_info["total_chunks"]:
        raise HTTPException(status_code=400, detail="모든 청크가 업로드되지 않았습니다")

    # 최종 파일 경로 설정
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{upload_info['filename']}"
    final_path = os.path.join(UPLOAD_DIR, filename)

    try:
        # 임시 파일을 최종 위치로 이동
        shutil.move(upload_info["temp_path"], final_path)

        # 실제 파일 크기 검증
        actual_size = os.path.getsize(final_path)
        if actual_size != upload_info["file_size"]:
            # 크기가 맞지 않으면 파일 삭제
            os.remove(final_path)
            raise HTTPException(status_code=400, detail="파일 크기가 일치하지 않습니다")

        # 비디오 메타데이터 추출 및 저장
        video_id = len(videos_db) + 1
        metadata = extract_video_metadata(final_path)
        video_info = {
            "id": video_id,
            "filename": filename,
            "original_name": upload_info["filename"],
            "file_path": final_path,
            "file_size": actual_size,
            "uploaded_at": datetime.now().isoformat(),
            "status": "uploaded",
            "duration": metadata["duration"],
            "thumbnail": metadata["thumbnail"]
        }
        videos_db.append(video_info)

        # 임시 데이터 정리
        del chunk_uploads[upload_id]

        return {
            "success": True,
            "message": f"'{upload_info['filename']}' 파일이 성공적으로 업로드되었습니다.",
            "video_id": video_id,
            "filename": filename
        }

    except Exception as e:
        # 오류 발생 시 임시 파일 정리
        if os.path.exists(upload_info["temp_path"]):
            os.remove(upload_info["temp_path"])
        del chunk_uploads[upload_id]
        raise HTTPException(status_code=500, detail=f"파일 완료 처리 중 오류 발생: {str(e)}")

# 기존 단일 파일 업로드 (호환성 유지)
@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """
    비디오 파일 업로드 (단일 파일, 호환성 유지)
    """
    # 확장자 검증 (파일명과 무관하게 확장자만 체크)
    allowed_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm']
    file_extension = os.path.splitext(file.filename)[1].lower()
    if file_extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다")

    # 파일 크기 제한 (2GB)
    file_size = 0
    content = await file.read()
    file_size = len(content)

    max_size = 2 * 1024 * 1024 * 1024  # 2GB
    if file_size > max_size:
        raise HTTPException(status_code=400, detail="파일 크기가 2GB를 초과합니다")

    # 파일 저장
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(content)

        # 비디오 메타데이터 추출 및 저장
        video_id = len(videos_db) + 1
        metadata = extract_video_metadata(file_path)
        video_info = {
            "id": video_id,
            "filename": filename,
            "original_name": file.filename,
            "file_path": file_path,
            "file_size": file_size,
            "uploaded_at": datetime.now().isoformat(),
            "status": "uploaded",  # uploaded, analyzing, completed, failed
            "analysis_result": None,
            "duration": metadata["duration"],
            "thumbnail": metadata["thumbnail"]
        }

        videos_db.append(video_info)

        return {
            "success": True,
            "message": "비디오가 성공적으로 업로드되었습니다",
            "video_id": video_id,
            "filename": filename
        }

    except Exception as e:
        # 업로드 실패시 파일 삭제
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"업로드 실패: {str(e)}")

@app.get("/videos")
async def get_videos():
    """
    업로드된 비디오 목록 조회
    """
    return {
        "videos": videos_db,
        "total": len(videos_db)
    }

@app.get("/shorts/videos")
async def get_completed_videos():
    """쇼츠 생성용 분석 완료된 비디오 목록 반환"""
    completed_videos = []
    
    for video in videos_db:
        if video["status"] == "completed" and "result_file" in video:
            # 결과 파일이 실제로 존재하는지 확인
            if os.path.exists(video["result_file"]):
                completed_videos.append({
                    "id": video["id"],
                    "original_name": video["original_name"],
                    "uploaded_at": video["uploaded_at"],
                    "duration": video.get("duration", "00:00"),
                    "thumbnail": video.get("thumbnail"),
                    "result_file": video["result_file"],
                    "total_scenes": video.get("analysis_result", {}).get("total_scenes", 0),
                    "dominant_mood": video.get("analysis_result", {}).get("overall_summary", {}).get("dominant_mood", "unknown"),
                    "shorts_status": video.get("shorts_status", "none"),
                    "shorts_progress": video.get("shorts_progress", 0),
                    "shorts_clips_count": video.get("shorts_clips_count", 0)
                })
    
    return {"videos": completed_videos, "total": len(completed_videos)}

@app.post("/shorts/generate/{video_id}")
async def generate_shorts(video_id: int, background_tasks: BackgroundTasks):
    """선택된 비디오의 쇼츠 생성"""
    # 비디오 찾기
    video = next((v for v in videos_db if v["id"] == video_id), None)
    if not video:
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다.")
    
    if video["status"] != "completed":
        raise HTTPException(status_code=400, detail="분석이 완료된 비디오만 쇼츠 생성이 가능합니다.")
    
    if not video.get("result_file") or not os.path.exists(video["result_file"]):
        raise HTTPException(status_code=400, detail="분석 결과 파일이 존재하지 않습니다.")
    
    # 쇼츠 생성 상태 초기화
    video["shorts_status"] = "generating"
    video["shorts_progress"] = 0
    
    # 백그라운드에서 쇼츠 생성 작업 시작
    background_tasks.add_task(perform_shorts_generation, video_id)
    
    return {
        "message": f"'{video['original_name']}' 쇼츠 생성을 시작했습니다.",
        "success": True,
        "video_id": video_id
    }

@app.get("/videos/{video_id}")
async def get_video(video_id: int):
    """
    특정 비디오 정보 조회
    """
    if video_id < 1 or video_id > len(videos_db):
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다")

    return videos_db[video_id - 1]

@app.post("/analyze/{video_id}")
async def analyze_video(video_id: int, background_tasks: BackgroundTasks):
    """
    비디오 분석 시작 (qwen2.5vl:7b 모델 사용)
    """
    if video_id < 1 or video_id > len(videos_db):
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다")

    video = videos_db[video_id - 1]

    if video["status"] == "analyzing":
        raise HTTPException(status_code=400, detail="이미 분석이 진행중입니다")

    # 분석 상태로 변경
    video["status"] = "analyzing"
    video["progress"] = 0
    
    # 백그라운드에서 분석 실행
    background_tasks.add_task(perform_video_analysis, video_id, video["file_path"])
    
    return {
        "success": True,
        "message": "비디오 분석을 시작했습니다",
        "video_id": video_id,
        "status": "analyzing"
    }

async def preload_ollama_models():
    """Ollama 모델들 사전 로드 (2개 인스턴스)"""
    try:
        logger.info("Ollama 모델 2개 인스턴스 사전 로드 중...")
        
        # 첫 번째 모델 인스턴스 로드
        payload1 = {
            "model": "qwen2.5vl:7b",
            "prompt": "Initialize model 1",
            "keep_alive": "30m",
            "options": {"num_predict": 1}
        }
        
        # 두 번째 모델 인스턴스 로드 (약간의 지연 후)
        payload2 = {
            "model": "qwen2.5vl:7b", 
            "prompt": "Initialize model 2",
            "keep_alive": "30m",
            "options": {"num_predict": 1}
        }
        
        # 병렬로 두 모델 로드
        tasks = [
            requests.post("http://127.0.0.1:11434/api/generate", json=payload1, timeout=60),
            requests.post("http://127.0.0.1:11434/api/generate", json=payload2, timeout=60)
        ]
        
        # 순차 실행 (안정성을 위해)
        for i, payload in enumerate([payload1, payload2], 1):
            try:
                response = requests.post("http://127.0.0.1:11434/api/generate", json=payload, timeout=60)
                if response.status_code == 200:
                    logger.info(f"Ollama 모델 인스턴스 {i} 로드 완료")
                else:
                    logger.warning(f"모델 인스턴스 {i} 로드 실패: {response.status_code}")
            except Exception as e:
                logger.warning(f"모델 인스턴스 {i} 로드 중 오류: {e}")
                
        logger.info("모든 Ollama 모델 인스턴스 로드 완료")
        
    except Exception as e:
        logger.warning(f"모델 사전 로드 중 전체 오류: {e}")

async def perform_video_analysis(video_id: int, video_path: str):
    """실제 비디오 분석 수행"""
    video = videos_db[video_id - 1]
    
    try:
        logger.info(f"비디오 {video_id} 분석 시작: {video_path}")
        
        # 모델 2개 인스턴스 사전 로드
        await preload_ollama_models()
        
        # 분석기 초기화
        scene_analyzer = SceneAnalyzer()
        batch_manager = BatchSizeManager()
        
        # 1단계: 프레임 추출 (1초 간격)
        logger.info("프레임 추출 시작...")
        video["progress"] = 10
        frames_data = await scene_analyzer.extract_frames_from_video(video_path, interval_seconds=1)
        
        if not frames_data:
            raise Exception("프레임 추출 실패")
        
        # 2단계: 장면 전환 감지
        logger.info("장면 전환 감지 중...")
        video["progress"] = 30
        scene_changes = scene_analyzer.detect_scene_changes(frames_data)
        detected_scenes = scene_analyzer.group_frames_by_scene(frames_data, scene_changes)
        
        # 배치 크기 계산
        batch_size = batch_manager.get_optimal_batch_size()
        expected_scene_count = max(1, math.ceil(len(frames_data) / batch_size))
        
        # 폴백 로직: 감지된 씬이 기대 씬 수보다 적으면 배치 단위로 강제 분할
        if len(detected_scenes) < expected_scene_count:
            logger.info(f"씬 감지 부족 ({len(detected_scenes)} < {expected_scene_count}): 배치 단위로 {expected_scene_count}개 씬 생성")
            scenes = build_scenes_by_batch(
                frames_data,
                scene_analyzer.interval_seconds,
                scene_analyzer.video_duration,
                batch_size
            )
        else:
            logger.info(f"씬 감지 충분: {len(detected_scenes)}개 씬 사용")
            scenes = detected_scenes
        
        # 3단계: 장면별 순차 분석 (안정성 우선)
        logger.info("장면 분석 시작...")
        analysis_results = []
        
        total_scenes = len(scenes)
        logger.info(f"총 {total_scenes}개 장면을 순차적으로 분석합니다...")
        
        # 순차 분석 (안정적이고 예측 가능)
        for i, scene in enumerate(scenes):
            try:
                logger.info(f"장면 {scene['scene_id']} 분석 중... ({i+1}/{total_scenes})")
                
                scene_analysis = await scene_analyzer.analyze_scene_batch(
                    scene['frames'],
                    scene['scene_id'], 
                    scene['start_time'],
                    scene['end_time']
                )
                
                analysis_results.append(scene_analysis)
                logger.info(f"장면 {scene['scene_id']} 분석 완료")
                
                # 진행률 업데이트 (30% ~ 90%)
                progress = 30 + int((i + 1) / total_scenes * 60)
                video["progress"] = progress
                
                # 메모리 정리
                gc.collect()
                
            except Exception as e:
                logger.error(f"장면 {scene['scene_id']} 분석 실패: {e}")
                fallback_analysis = scene_analyzer.create_fallback_analysis(
                    scene['scene_id'],
                    scene['start_time'], 
                    scene['end_time']
                )
                analysis_results.append(fallback_analysis)
        
        # 메모리 정리
        gc.collect()
        
        # 4단계: 전체 요약 생성
        logger.info("전체 분석 요약 생성 중...")
        video["progress"] = 90
        
        overall_summary = generate_overall_summary(analysis_results, frames_data)
        
        # 5단계: 결과 저장
        logger.info("결과 저장 중...")
        final_result = {
            "video_id": video_id,
            "analysis_timestamp": datetime.now().isoformat(),
            "total_scenes": len(analysis_results),
            "total_frames": len(frames_data),
            "video_duration": scene_analyzer.video_duration,
            "overall_summary": overall_summary,
            "scene_analysis": analysis_results
        }
        
        # temp/영상파일명.json에 저장
        video_filename = os.path.splitext(video["original_name"])[0]  # 확장자 제거
        result_file_path = os.path.join(RESULTS_DIR, f"{video_filename}.json")
        async with aiofiles.open(result_file_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(final_result, ensure_ascii=False, indent=2))
        
        # 비디오 상태 업데이트
        video["status"] = "completed"
        video["progress"] = 100
        video["analysis_result"] = final_result
        video["result_file"] = result_file_path
        
        logger.info(f"비디오 {video_id} 분석 완료")
        
    except Exception as e:
        logger.error(f"비디오 {video_id} 분석 실패: {e}")
        video["status"] = "failed"
        video["progress"] = 0
        video["error"] = str(e)

async def perform_shorts_generation(video_id: int):
    """쇼츠 생성 작업 수행 (백그라운드)"""
    try:
        video = next((v for v in videos_db if v["id"] == video_id), None)
        if not video:
            logger.error(f"쇼츠 생성 실패: 비디오 {video_id}를 찾을 수 없음")
            return
        
        logger.info(f"쇼츠 생성 시작: {video['original_name']}")
        
        # 분석 결과 파일 읽기
        async with aiofiles.open(video["result_file"], 'r', encoding='utf-8') as f:
            analysis_data = json.loads(await f.read())
        
        # 하이라이트 장면 추출
        highlight_scenes = []
        for scene in analysis_data.get("scene_analysis", []):
            if scene.get("highlight_score", 0) > 0.7:  # 하이라이트 점수 0.7 이상
                highlight_scenes.append(scene)
        
        if not highlight_scenes:
            logger.warning(f"하이라이트 장면이 없어서 상위 3개 장면 선택: {video['original_name']}")
            # 하이라이트가 없으면 상위 3개 장면 선택
            scenes_by_score = sorted(
                analysis_data.get("scene_analysis", []), 
                key=lambda x: x.get("highlight_score", 0), 
                reverse=True
            )
            highlight_scenes = scenes_by_score[:3]
        
        # 쇼츠 클립 정보 생성
        shorts_clips = []
        for i, scene in enumerate(highlight_scenes[:5]):  # 최대 5개 클립
            clip_info = {
                "clip_id": i + 1,
                "scene_id": scene.get("scene_id"),
                "start_time": scene.get("time_range", {}).get("start", 0),
                "end_time": scene.get("time_range", {}).get("end", 0),
                "duration": scene.get("time_range", {}).get("duration", 0),
                "description": scene.get("scene_description", ""),
                "mood": scene.get("mood", "neutral"),
                "highlight_score": scene.get("highlight_score", 0)
            }
            shorts_clips.append(clip_info)
        
        # 쇼츠 정보 저장
        shorts_result = {
            "video_id": video_id,
            "video_name": video["original_name"],
            "generation_timestamp": datetime.now().isoformat(),
            "total_clips": len(shorts_clips),
            "clips": shorts_clips
        }
        
        # 쇼츠 결과 파일 저장
        video_filename = os.path.splitext(video["original_name"])[0]
        shorts_file_path = os.path.join(SHORTS_DIR, f"{video_filename}_shorts.json")
        async with aiofiles.open(shorts_file_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(shorts_result, ensure_ascii=False, indent=2))
        
        # 쇼츠 생성 완료 상태 업데이트
        video["shorts_status"] = "completed"
        video["shorts_progress"] = 100
        video["shorts_file"] = shorts_file_path
        video["shorts_clips_count"] = len(shorts_clips)
        
        logger.info(f"쇼츠 생성 완료: {len(shorts_clips)}개 클립 - {shorts_file_path}")
        
    except Exception as e:
        logger.error(f"쇼츠 생성 실패 (비디오 {video_id}): {e}")
        
        # 쇼츠 생성 실패 상태 업데이트
        video = next((v for v in videos_db if v["id"] == video_id), None)
        if video:
            video["shorts_status"] = "failed"
            video["shorts_progress"] = 0

def build_scenes_by_batch(frames_data: List[Dict], interval_sec: float, video_duration: float, batch_size: int) -> List[Dict]:
    """배치 단위로 씬을 강제 생성"""
    scenes = []
    n = len(frames_data)
    
    for i in range(0, n, batch_size):
        chunk = frames_data[i:i+batch_size]
        start_time = float(chunk[0]['timestamp'])
        
        # 다음 배치의 첫 프레임 시각 (없으면 비디오 끝)
        next_batch_start = float(frames_data[i+batch_size]['timestamp']) if (i+batch_size) < n else video_duration
        
        # 종료 시각: 마지막 프레임 + 간격, 다음 배치 시작, 비디오 끝 중 최소값
        end_time = min(
            float(chunk[-1]['timestamp']) + interval_sec,
            next_batch_start,
            video_duration
        )
        
        # 시작과 끝이 같으면 최소 간격 보장
        if end_time <= start_time:
            end_time = min(start_time + interval_sec, video_duration)
            
        scenes.append({
            'scene_id': len(scenes) + 1,
            'start_time': start_time,
            'end_time': end_time,
            'frames': chunk
        })
    
    logger.info(f"배치 단위로 {len(scenes)}개 씬 생성 (배치 크기: {batch_size})")
    return scenes

def generate_overall_summary(analysis_results, frames_data):
    """전체 분석 결과 요약 생성"""
    try:
        # 분위기 분포 계산
        mood_counts = {}
        highlight_scenes = []
        total_highlight_score = 0
        
        for result in analysis_results:
            mood = result.get('mood', 'unknown')
            mood_counts[mood] = mood_counts.get(mood, 0) + 1
            
            highlight_score = result.get('highlight_score', 0)
            total_highlight_score += highlight_score
            
            if highlight_score > 0.7:
                highlight_scenes.append(result)
        
        # 주요 분위기 결정
        dominant_mood = max(mood_counts, key=mood_counts.get) if mood_counts else 'unknown'
        
        return {
            "dominant_mood": dominant_mood,
            "mood_distribution": mood_counts,
            "total_scenes": len(analysis_results),
            "highlight_scenes": len(highlight_scenes),
            "average_highlight_score": total_highlight_score / len(analysis_results) if analysis_results else 0,
            "recommended_clips": highlight_scenes[:5],  # 상위 5개 하이라이트
            "analysis_quality": "good" if len([r for r in analysis_results if not r.get('error', False)]) > len(analysis_results) * 0.8 else "fair"
        }
        
    except Exception as e:
        logger.error(f"요약 생성 실패: {e}")
        return {
            "dominant_mood": "unknown",
            "mood_distribution": {},
            "total_scenes": len(analysis_results),
            "highlight_scenes": 0,
            "average_highlight_score": 0,
            "recommended_clips": [],
            "analysis_quality": "error"
        }

@app.post("/generate-shorts/{video_id}")
async def generate_shorts(video_id: int, criteria: Dict[str, Any] = None):
    """
    분석 결과를 기반으로 쇼츠 생성
    """
    if video_id < 1 or video_id > len(videos_db):
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다")

    video = videos_db[video_id - 1]

    if video["status"] != "completed":
        raise HTTPException(status_code=400, detail="먼저 비디오 분석을 완료해야 합니다")

    try:
        # TODO: 실제 쇼츠 생성 로직 구현
        # 1. 분석 결과에서 하이라이트 구간 추출
        # 2. FFmpeg으로 클립 생성
        # 3. 결과 저장

        # 임시 응답 (실제 구현시 제거)
        shorts_result = {
            "shorts_generated": 3,
            "clips": [
                {
                    "id": 1,
                    "start_time": "00:00:05",
                    "end_time": "00:00:15",
                    "mood": "excited",
                    "description": "가장 신나는 부분"
                },
                {
                    "id": 2,
                    "start_time": "00:01:20",
                    "end_time": "00:01:30",
                    "mood": "happy",
                    "description": "웃음이 많은 부분"
                },
                {
                    "id": 3,
                    "start_time": "00:03:45",
                    "end_time": "00:03:55",
                    "mood": "emotional",
                    "description": "감정적인 부분"
                }
            ]
        }

        return {
            "success": True,
            "message": "쇼츠 생성이 완료되었습니다",
            "video_id": video_id,
            "shorts_result": shorts_result
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"쇼츠 생성 실패: {str(e)}")

@app.delete("/videos/{video_id}")
async def delete_video(video_id: int):
    """
    비디오 및 관련 파일 삭제
    """
    if video_id < 1 or video_id > len(videos_db):
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다")

    video = videos_db[video_id - 1]

    try:
        # 파일 삭제
        if os.path.exists(video["file_path"]):
            os.remove(video["file_path"])

        # 분석 결과 삭제 (있는 경우)
        if video["analysis_result"]:
            result_file = os.path.join(ANALYSIS_DIR, f"analysis_{video_id}.json")
            if os.path.exists(result_file):
                os.remove(result_file)

        # 목록에서 제거
        videos_db.pop(video_id - 1)

        return {
            "success": True,
            "message": "비디오가 성공적으로 삭제되었습니다"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"삭제 실패: {str(e)}")

# 에러 핸들러
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail,
            "timestamp": datetime.now().isoformat()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "서버 내부 오류가 발생했습니다",
            "detail": str(exc),
            "timestamp": datetime.now().isoformat()
        }
    )

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,  # 성능 최적화를 위해 리로드 비활성화
        log_level="info"
    )
