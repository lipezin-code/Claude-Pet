!macro customInstall
  IfSilent claudepet_done
  nsExec::ExecToStack 'where claude'
  Pop $0
  Pop $1
  StrCmp $0 "0" claudepet_found
    MessageBox MB_OK|MB_ICONINFORMATION "Claude Code não foi encontrado no PATH. O Claude Pet funciona assim que você instalá-lo; depois ative a integração em Configurações > Claude Code."
    Goto claudepet_auto
  claudepet_found:
  MessageBox MB_YESNO|MB_ICONQUESTION "Integrar o Claude Pet com o Claude Code?$\r$\n$\r$\nIsso adiciona hooks de observação ao settings.json do Claude Code (com backup, sem apagar hooks existentes). Você pode remover depois nas Configurações ou ao desinstalar." IDNO claudepet_auto
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --install-hooks'
  claudepet_auto:
  MessageBox MB_YESNO|MB_ICONQUESTION "Iniciar o Claude Pet automaticamente com o Windows?" IDNO claudepet_done
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --enable-autostart'
  claudepet_done:
!macroend

!macro customUnInstall
  ; update = o instalador novo roda este desinstalador antes: não remover hooks/ponte/autostart nesse caso
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-hooks'
  ${endIf}
!macroend
