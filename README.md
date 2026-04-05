# 🧠 AI-Interviewer Platform

![AI Interviewer Banner](https://img.shields.io/badge/Status-Active-success.svg)
![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB.svg?logo=react)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?logo=fastapi)
![Groq](https://img.shields.io/badge/LLM-Groq%20Llama%203.3%2070B-orange.svg)
![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E.svg?logo=supabase)

An end-to-end, AI-native technical interviewing platform designed to simulate realistic, professional tech interviews. It deeply analyzes candidate responses—both voice and code—providing adaptive technical follow-ups and generating incredibly detailed analytical reports.

---

## ✨ Core Features

* **Adaptive AI Interviews:** Powered by **Groq (`llama-3.3-70b-versatile`)**, the platform reads the candidate's uploaded resume, automatically extracting their core technical stack, and dynamically structures questions based on their reported skill level.
* **Multiple Interview Tracks:**
    * **Technical Fundamentals:** Operating Systems, Networking, DBMS, OOP, System Design. 
    * **DSA / Coding:** Built-in IDE/Code Editor with auto-evaluation for constraints, edge cases, and time complexity.
    * **HR / Behavioral:** STAR-method situational evaluation.
    * **System Design:** Distributed systems, scalability, and API architecture questions.
* **Full-Duplex Communication:** Real-time Voice-to-Text inference driving a conversational flow. 
* **Rich Analytics & Reporting:** 
    * **Radar Skill Charts:** Visual mapping of 6-axis competencies (e.g., Problem Understanding, Algorithm Design, Code Quality).
    * **Granular Breakdown:** Per-category evaluation masking (OOP vs. Node.js vs. SQL).
    * **Actionable Feedback:** Automatic extraction of what the candidate fundamentally misunderstood alongside personalized study resources.
* **Premium SaaS UI:** Minimalist, glassmorphic layout inspired by modern Vercel/Linear aesthetics, built on React + Tailwind.

---

## 🏗️ Architecture Stack

### Frontend 
* **Framework:** React + Vite
* **Styling:** Tailwind CSS + Vanilla CSS (`Plus Jakarta Sans`)
* **Data Vis:** Custom radar charts and scalable progress bars mapping 0-10 backend scores to 0-100 visual UI data.
* **State Management:** React hooks / Context, Local `sessionStorage` architecture ensuring resilience against brief network drops.

### Backend 
* **Framework:** Python / FastAPI
* **Database:** Supabase (PostgreSQL) 
* **Inference Models:** Groq Cloud 

---

## 🚀 Local Setup & Installation

### Prerequisites
* Node.js (v18+)
* Python 3.10+
* A [Groq](https://groq.com/) API Key
* A [Supabase](https://supabase.com/) Project

### 1. Clone the Repository
```bash
git clone https://github.com/RounakChatterjee2004/AI-Interviewer.git
cd AI-Interviewer
```

### 2. Backend Environment 
```bash
cd backend
python -m venv venv

# Activate (Windows)
venv\Scripts\activate
# Activate (Mac/Linux)
source venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file in the `/backend` directory:
```env
GROQ_API_KEY=your_groq_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_key
SUPABASE_JWT_SECRET=your_jwt_secret
```

### 3. Frontend Environment
```bash
cd ../frontend
npm install
```

Create a `.env` file in the `/frontend` directory:
```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Running the Platform
Open two terminal windows:

**Terminal 1 (Backend - FastAPI Server):**
```bash
cd backend
venv\Scripts\activate
uvicorn main:app --reload
```

**Terminal 2 (Frontend - React Server):**
```bash
cd frontend
npm run dev
```

The application will be accessible at `http://localhost:5173`.

---

## 🤝 Contributing
Contributions, issues, and feature requests are always welcome! Feel free to check the issues page.

## 📝 License
This project is open-source.
# Ai-Interviewer-Main
..
