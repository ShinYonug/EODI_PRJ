# EODI - Video Analysis & Shorts Generator

영상 분석 및 자동 쇼츠 생성을 위한 데스크톱 애플리케이션입니다. qwen2.5-vl-7b 비전 모델을 활용하여 영상에서 프레임을 추출하고 분위기, 상황, 감정을 분석하여 자동으로 쇼츠 클립을 생성합니다.

## 🚀 주요 기능

- **자동 Ollama 설치**: 앱 시작과 동시에 Ollama 및 qwen2.5-vl-7b 모델 자동 설치
- **비디오 업로드**: 드래그 앤 드롭으로 손쉬운 비디오 파일 업로드
- **프레임 분석**: 10초 단위로 프레임을 추출하여 AI 모델로 분석
- **감정 분석**: 분위기, 상황, 감정을 JSON 형태로 분석
- **자동 쇼츠 생성**: 분석 결과를 기반으로 하이라이트 클립 추출
- **데스크톱 앱**: Electron 기반의 직관적인 GUI

## 🏗️ 프로젝트 구조

```
EODI_PRJ/
├── frontend/              # Electron 데스크톱 앱
│   ├── src/
│   │   ├── main.js        # Electron 메인 프로세스 (Ollama 자동 설치)
│   │   └── renderer/      # 렌더러 프로세스
│   │       ├── index.html
│   │       ├── style.css
│   │       └── script.js
│   ├── package.json
│   └── node_modules/
├── backend/               # FastAPI 서버
│   ├── main.py
│   ├── requirements.txt
│   └── venv/
└── README.md
```

## 🛠️ 설치 및 실행

### 1. 자동 설치 (권장)
프로그램을 처음 실행하면 자동으로 Ollama와 qwen2.5-vl-7b 모델이 설치됩니다.

```bash
cd EODI_PRJ/frontend
npm start
```

### 2. 수동 설치 (선택사항)
Ollama를 미리 설치하려면:

```bash
# Ollama 설치
curl -fsSL https://ollama.ai/install.sh | sh

# qwen2.5-vl-7b 모델 다운로드
ollama pull qwen2.5-vl-7b

# 백엔드 실행
cd backend
source venv/bin/activate
python main.py
```

## 🔧 OS별 Ollama 경로

**Windows:**
- 설치 경로: `C:\EODI\ollama`

**macOS:**
- 설치 경로: `~/Desktop/ollama`

## 📋 API 엔드포인트

### 비디오 관리
- `POST /upload` - 비디오 파일 업로드
- `GET /videos` - 업로드된 비디오 목록 조회
- `GET /videos/{video_id}` - 특정 비디오 정보 조회
- `DELETE /videos/{video_id}` - 비디오 삭제

### 분석 기능
- `POST /analyze/{video_id}` - 비디오 분석 시작
- `POST /generate-shorts/{video_id}` - 쇼츠 생성

### 상태 확인
- `GET /` - API 상태 확인
- `GET /health` - 헬스 체크

## 🎯 사용 방법

1. **앱 실행**: `npm start`로 Electron 앱을 실행합니다 (Ollama 자동 설치 시작)
2. **설치 대기**: 좌측 하단에서 Ollama 설치 진행 상황을 확인합니다
3. **비디오 업로드**: 설치 완료 후 '업로드' 메뉴에서 비디오 파일을 드래그 앤 드롭합니다
4. **목록 확인**: '목록' 메뉴에서 업로드된 비디오들을 확인합니다
5. **분석 시작**: 목록에서 비디오를 선택하고 분석을 시작합니다
6. **쇼츠 생성**: 분석 완료 후 '쇼츠생성' 메뉴에서 자동 클립 생성합니다

## 🔄 분석 파이프라인

```
앱 시작 → Ollama 자동 설치 → qwen2.5-vl-7b 모델 로드
    ↓
비디오 업로드 → 프레임 추출 (10초 단위) → qwen2.5-vl-7b 분석 → JSON 결과 → 클립 추출
```

### 분석 결과 예시
```json
{
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
    }
  ]
}
```

## 🚧 개발 예정 기능

- [ ] 실시간 분석 진행 상태 표시
- [ ] 사용자 정의 분석 기준 설정
- [ ] 배치 비디오 처리
- [ ] 분석 결과 내보내기
- [ ] 쇼츠 편집 인터페이스
- [ ] 다중 모델 지원 (GPT-4V, Claude 등)

## 📝 라이선스

MIT License

## 🤝 기여

프로젝트 개선을 위한 기여를 환영합니다!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 문의

프로젝트 관련 문의사항은 이슈를 통해 남겨주세요.
