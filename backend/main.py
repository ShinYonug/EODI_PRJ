from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import os
from datetime import datetime
from typing import List, Dict, Any
import json

# FastAPI 앱 생성
app = FastAPI(
    title="EODI Video Analysis API",
    description="비디오 분석 및 쇼츠 생성을 위한 API",
    version="1.0.0"
)

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

# 비디오 메타데이터 저장 (간단한 인메모리 저장소 - 실제로는 데이터베이스 사용 권장)
videos_db = []

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

@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """
    비디오 파일 업로드
    """
    # 파일 타입 검증
    if not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="비디오 파일만 업로드 가능합니다")

    # 파일 크기 제한 (2GB)
    file_size = 0
    content = await file.read()
    file_size = len(content)

    max_size = 2 * 1024 * 1024 * 1024  # 2GB
    if file_size > max_size:
        raise HTTPException(status_code=400, detail="파일 크기가 2GB를 초과합니다")

    # 파일 저장
    file_extension = os.path.splitext(file.filename)[1]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(content)

        # 비디오 메타데이터 저장
        video_id = len(videos_db) + 1
        video_info = {
            "id": video_id,
            "filename": filename,
            "original_name": file.filename,
            "file_path": file_path,
            "file_size": file_size,
            "upload_date": datetime.now().isoformat(),
            "status": "uploaded",  # uploaded, analyzing, completed, failed
            "analysis_result": None,
            "duration": None,
            "thumbnail": None
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

@app.get("/videos/{video_id}")
async def get_video(video_id: int):
    """
    특정 비디오 정보 조회
    """
    if video_id < 1 or video_id > len(videos_db):
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다")

    return videos_db[video_id - 1]

@app.post("/analyze/{video_id}")
async def analyze_video(video_id: int):
    """
    비디오 분석 시작 (qwen2.5-vl-7b 모델 사용)
    """
    if video_id < 1 or video_id > len(videos_db):
        raise HTTPException(status_code=404, detail="비디오를 찾을 수 없습니다")

    video = videos_db[video_id - 1]

    if video["status"] != "uploaded":
        raise HTTPException(status_code=400, detail="이미 분석이 진행중이거나 완료된 비디오입니다")

    try:
        # 분석 상태로 변경
        video["status"] = "analyzing"

        # TODO: 실제 분석 로직 구현
        # 1. 10초 단위 프레임 추출
        # 2. Ollama qwen2.5-vl-7b 모델로 분석
        # 3. JSON 형태로 결과 저장

        # 임시로 분석 완료로 설정 (실제 구현시 제거)
        video["status"] = "completed"
        video["analysis_result"] = {
            "frames_analyzed": 10,
            "total_duration": "00:05:30",
            "mood_analysis": {
                "happy": 0.7,
                "sad": 0.1,
                "excited": 0.8,
                "calm": 0.3
            },
            "scene_analysis": [
                {
                    "timestamp": "00:00:10",
                    "description": "밝은 실내에서 웃으며 이야기하는 장면",
                    "mood": "happy",
                    "intensity": 0.8
                },
                {
                    "timestamp": "00:00:20",
                    "description": "창가에서 생각에 잠긴 모습",
                    "mood": "calm",
                    "intensity": 0.4
                }
            ]
        }

        return {
            "success": True,
            "message": "비디오 분석이 완료되었습니다",
            "video_id": video_id,
            "analysis_result": video["analysis_result"]
        }

    except Exception as e:
        video["status"] = "failed"
        raise HTTPException(status_code=500, detail=f"분석 실패: {str(e)}")

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
        reload=True,
        log_level="info"
    )
