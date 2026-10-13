; Custom NSIS Installer Script for ShoeDZ Desktop

!macro customInstall
  SetShellVarContext all
  ; Ensure %ProgramData%\ShoeDZ directories exist
  CreateDirectory "$APPDATA\ShoeDZ"
  CreateDirectory "$APPDATA\ShoeDZ\backups"
  CreateDirectory "$APPDATA\ShoeDZ\media"
  CreateDirectory "$APPDATA\ShoeDZ\logs"

  ; Grant full modify permissions to local Users using built-in icacls
  ; S-1-5-32-545 is the universal language-independent SID for Built-in Users
  ExecWait 'icacls "$APPDATA\ShoeDZ" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
!macroend

!macro customUnInstall
  SetShellVarContext all
  ; Prompt user to preserve their store database and backups
  MessageBox MB_YESNO|MB_ICONQUESTION "Souhaitez-vous conserver la base de données et les sauvegardes de vos magasins ?" IDYES keepData IDNO removeData

  removeData:
    RMDir /r "$APPDATA\ShoeDZ"
    Goto done

  keepData:
    DetailPrint "Données et sauvegardes conservées."

  done:
!macroend
