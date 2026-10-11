; Custom NSIS Installer Script for ShoeDZ Desktop

!macro customInstall
  ; Ensure %ProgramData%\ShoeDZ directories exist
  CreateDirectory "$COMMONAPPDATA\ShoeDZ"
  CreateDirectory "$COMMONAPPDATA\ShoeDZ\backups"
  CreateDirectory "$COMMONAPPDATA\ShoeDZ\media"
  CreateDirectory "$COMMONAPPDATA\ShoeDZ\logs"

  ; Grant full modify permissions to local Users using built-in icacls
  ; S-1-5-32-545 is the universal language-independent SID for Built-in Users
  ExecWait 'icacls "$COMMONAPPDATA\ShoeDZ" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'
!macroend

!macro customUnInstall
  ; Prompt user to preserve their store database and backups
  MessageBox MB_YESNO|MB_ICONQUESTION "Souhaitez-vous conserver la base de données et les sauvegardes de vos magasins ?" IDYES keepData IDNO removeData

  removeData:
    RMDir /r "$COMMONAPPDATA\ShoeDZ"
    Goto done

  keepData:
    DetailPrint "Données et sauvegardes conservées."

  done:
!macroend
