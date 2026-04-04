@echo off
cd /d %~dp0
if not exist .env (
  echo Copie .env.example para .env e preencha suas chaves antes de continuar.
  pause
  exit /b 1
)
call npm install
call npm start
pause
