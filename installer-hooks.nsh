; NSIS hooks of the Tauri installer.
; Uninstall: remove the "start with Windows" entry the app may have written (Settings > Windows; ASCII only in this file),
; otherwise Windows keeps trying to start a program that no longer exists.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeadlockCompanion"
!macroend
