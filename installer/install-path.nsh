!include "FileFunc.nsh"
!include "LogicLib.nsh"

; 安装目录独立于软件显示名称，默认路径也只使用这一层主文件夹。
!undef APP_FILENAME
!define APP_FILENAME "Little Fish Planner"

; 在真正写入文件之前再次约束目录，静默安装与直接运行引擎也遵守同一规则。
!macro customInit
  GetFullPathName $INSTDIR "$INSTDIR"
  ${GetFileName} "$INSTDIR" $R1
  ${If} $R1 != "Little Fish Planner"
    StrCpy $INSTDIR "$INSTDIR\Little Fish Planner"
  ${EndIf}
  GetFullPathName $INSTDIR "$INSTDIR"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\YuyuPlanner" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Publisher" "StarAsh"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\YuyuPlanner"
!macroend
