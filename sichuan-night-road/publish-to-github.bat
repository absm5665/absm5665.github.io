@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo  ============================================================
echo   把「乡道 20:30」推送到 GitHub Pages
echo   目标仓库：absm5665/absm5665.github.io
echo   推送后访问：https://absm5665.github.io/sichuan-night-road/
echo  ============================================================
echo.
echo   做法：克隆你已有的站点仓库，把这个目录放进
echo         sichuan-night-road/ 子目录，然后提交推送。
echo         原有文件不会被改动。
echo.
echo   第一次推送时，会弹出 GitHub 的登录/授权窗口，
echo   用 absm5665 账号登录一次即可，之后就记住了。
echo.
pause

git --version >nul 2>&1
if errorlevel 1 (
  echo [x] 没找到 git，请先安装 Git for Windows：https://git-scm.com/download/win
  pause
  exit /b 1
)

set "TMPDIR=%TEMP%\ghsite_push"
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"

echo.
echo [1/5] 克隆仓库...
git clone --depth 1 https://github.com/absm5665/absm5665.github.io.git "%TMPDIR%"
if errorlevel 1 (
  echo [x] 克隆失败，检查网络或仓库地址
  pause
  exit /b 1
)

echo [2/5] 拷贝文件...
if exist "%TMPDIR%\sichuan-night-road" rmdir /s /q "%TMPDIR%\sichuan-night-road"
mkdir "%TMPDIR%\sichuan-night-road"
copy /y "index.html" "%TMPDIR%\sichuan-night-road\" >nul
if exist "README.md" copy /y "README.md" "%TMPDIR%\sichuan-night-road\" >nul
xcopy /E /I /Y /Q "js" "%TMPDIR%\sichuan-night-road\js\" >nul
xcopy /E /I /Y /Q "music" "%TMPDIR%\sichuan-night-road\music\" >nul

echo [3/5] 提交...
cd /d "%TMPDIR%"
git config user.email "absm5665@users.noreply.github.com"
git config user.name "absm5665"
git add -A
git commit -m "feat: 乡道 20:30 — 四川乡间公路夜间场景 + 老收音机" >nul
if errorlevel 1 echo      （没有新改动需要提交）

echo [4/5] 推送...
git push origin main
if errorlevel 1 (
  echo.
  echo [x] 推送失败。如果是登录问题，重新运行一次这个脚本，
  echo     在弹出的窗口里用 GitHub 账号登录即可。
  pause
  exit /b 1
)

echo [5/5] 完成
echo.
echo  ------------------------------------------------------------
echo   等 1-2 分钟，然后打开：
echo     https://absm5665.github.io/sichuan-night-road/
echo.
echo   想自己放歌：把音频文件放进本目录的 music\ 文件夹，
echo   再运行一次这个脚本即可。
echo  ------------------------------------------------------------
echo.

rd /s /q "%TMPDIR%" 2>nul
pause
