@echo off
cd /d "%~dp0"
npm run dev > vite-dev.out.log 2> vite-dev.err.log
