# 두 줄 노래방 자막 만들기 - GitHub Pages

이 폴더는 GitHub Pages에 올릴 배포본입니다.

## 처음 한 번만 올리기

1. GitHub에서 새 저장소를 만듭니다. 이름 예시: `karaoke-subtitle-maker`.
2. 저장소의 **Settings → Pages**에서 **Deploy from a branch**, **main / (root)**를 선택합니다.
3. PowerShell에서 이 폴더를 열고 다음처럼 실행합니다.

```powershell
.\publish-to-github.ps1 -RepositoryUrl "https://github.com/내아이디/karaoke-subtitle-maker.git"
```

처음 실행할 때 GitHub 로그인 창이 나오면 로그인합니다. 완료되면 GitHub Pages 주소가 생성됩니다.

## 사이트를 수정한 뒤 갱신하기

새 `index.html`을 이 폴더에 덮어쓴 뒤 같은 명령을 다시 실행합니다.
