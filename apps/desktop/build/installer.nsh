; Extra uninstall step for Producers Toolbox (included by electron-builder, see "nsis.include").
; The app's "Uninstall Toolbox" menu writes a marker file into the user-data folder when the user
; ticks "Also delete my data". Only then is that folder removed. Updates (which run the old
; uninstaller silently with --updated) never delete data.
; Must match the userData path set in src/main/main.js for the packaged app.
!ifndef TOOLBOX_DATA_DIR
  !define TOOLBOX_DATA_DIR "$APPDATA\Producers Toolbox"
!endif

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; "Start with Windows" (app.setLoginItemSettings) entry, named after the app's AppUserModelId.
    ; The second name is what builds before setAppUserModelId used.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${PRODUCT_NAME}"
    ${if} ${FileExists} "${TOOLBOX_DATA_DIR}\.delete-on-uninstall"
      RMDir /r "${TOOLBOX_DATA_DIR}"
    ${endIf}
  ${endIf}
!macroend
