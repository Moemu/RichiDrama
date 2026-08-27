@echo off
chcp 65001 >nul
setlocal
rem ============================================================================
rem 一键启动本地开发环境：后端 (5679) + 前端 (3013)
rem 双击运行即可。关闭时直接关掉弹出的两个 cmd 窗口。
rem ----------------------------------------------------------------------------
rem 【为什么不能直接 npm run dev】
rem   后端必须以 MINIDRAMA_PROFILE=dev 启动（等价于旧的显式
rem   CFG_IMAGE_PROXY__USE_FOR_VIDEO=false），否则视频生成本地参考图会走中转图床，
rem   响应慢时把异步任务阻塞数分钟。详见 AGENTS.md「本地调试启动」。
rem   线上由部署注入 prod/preview 档位，互不影响。
rem ============================================================================

set ROOT=%~dp0
set BACKEND_PORT=5679
set FRONTEND_PORT=3013

echo ===========================================
echo  RichiDrama 本地开发环境一键启动
echo ===========================================

rem [1/3] 清理残留旧进程（避免端口冲突把 Vite 挤到别的端口）
echo.
echo [1/3] 清理旧进程...
call :kill_port %BACKEND_PORT%
call :kill_port %FRONTEND_PORT%

rem [2/3] 启动后端（从 backend-node 目录启动 + 本地调试环境变量）
echo.
echo [2/3] 启动后端 (:%BACKEND_PORT%)...
start "RichiDrama-Backend" cmd /k "cd /d %ROOT%backend-node && set MINIDRAMA_PROFILE=dev && echo 后端运行中 (profile=dev)，按 Ctrl+C 停止 && npm run dev"

rem [3/3] 启动前端
echo.
echo [3/3] 启动前端 (:%FRONTEND_PORT%)...
start "RichiDrama-Frontend" cmd /k "cd /d %ROOT%frontweb && echo 前端运行中，按 Ctrl+C 停止 && npm run dev"

echo.
echo ===========================================
echo  已启动。等待后端就绪后打开浏览器...
echo   前端: http://localhost:%FRONTEND_PORT%/
echo   后端: http://localhost:%BACKEND_PORT%/api/v1
echo ===========================================

echo 等待后端健康检查...
set /a tries=0
:waitloop
set /a tries+=1
powershell -Command "try { $r=Invoke-RestMethod 'http://localhost:%BACKEND_PORT%/health' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  echo [OK] 后端就绪
  goto openbrowser
)
if %tries% geq 40 (
  echo [WARN] 后端 40s 内未就绪，请查看后端窗口日志
  goto openbrowser
)
timeout /t 1 /nobreak >nul
goto waitloop

:openbrowser
timeout /t 1 /nobreak >nul
start http://localhost:%FRONTEND_PORT%/
endlocal
exit /b

:kill_port
rem 杀掉占用某端口的进程 %1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%1 " ^| findstr "LISTENING"') do (
  echo   端口 %1 被 PID %%a 占用，正在停止...
  taskkill /PID %%a /F >nul 2>&1
)
exit /b
