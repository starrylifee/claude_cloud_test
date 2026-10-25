# 하늘 수첩

내가 **본 것**, **찍은 것**, **알아본 것**을 성도 위에 쌓아 가는 관측 일지예요. 걸은 길을 지도에 칠해 가는 앱처럼, 기록할수록 밤하늘이 내 것으로 밝아져요.

- 메시에 110 · NGC/IC 5,200여 개 · 별자리 88 · 이름 있는 별 · 행성과 달(날짜별 위치) · 혜성(궤도 요소 또는 직접 찍은 위치)
- 기록 방식은 세 가지이고 따로따로 남길 수 있어요: 봤어요(금색) · 찍었어요(청록) · 알아봤어요(보라)
- 색 규칙은 어디서나 같아요. 천체의 색은 대표 방식(찍음 › 봄 › 알아봄)이고, 작은 점은 만난 방식 전부예요.
- 찍었어요를 고르면 사진을 올릴 수 있고, 올린 사진은 성도 위 천체 옆에 떠요.
- 기록하면 그 천체로 날아가 축하 효과가 터져요. 별자리는 선이 하나씩 켜지고, 메시에 10개마다 유성우가 내려요.
- 두 사람(나 / 짝꿍 / 둘 다) 보기, 관측지 지평선, 붉은 야간 모드, JSON 백업과 복원을 지원해요.

## 실행

빌드가 필요 없어요. `index.html`을 브라우저로 열면 돼요. 정적 서버로 띄워도 돼요.

```sh
cd sky-log && python3 -m http.server 8000   # http://localhost:8000
```

기록은 지금 브라우저의 IndexedDB에 저장돼요. 다른 기기로 옮길 때는 설정(⋯)에서 백업을 내려받아 불러오면 돼요.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html`, `css/app.css` | 화면 틀과 스타일 |
| `js/catalog.js` | 별·별자리·심우주 천체·은하수 데이터 (생성 파일) |
| `js/astro.js` | 시간, 스테레오 투영, 행성·달·혜성 위치, 별자리 판정 |
| `js/sky.js` | 성도 렌더러(바탕 캔버스 + 애니메이션 캔버스), 라벨 배치, 축하 효과 |
| `js/store.js` | 저장소. `LocalBackend`(IndexedDB)와 아직 연결하지 않은 `CloudBackend` 틀 |
| `js/app.js` | 패널, 기록·혜성·설정 창, 검색, 축하 흐름 |
| `tools/build_catalog.py` | `catalog.js` 생성 스크립트 |

## 클라우드 (두 사람용, 아직 연결 안 함)

`js/store.js`의 `CloudBackend`는 메서드 모양만 잡아 두었고, 호출하면 `NotConnectedError`를 던져요. 연결할 때는 다음 순서로 하면 돼요.

1. 저장소를 하나 고르고 `CloudBackend`의 메서드를 구현해요. 예를 들어 Supabase라면 `observers`, `observations`, `comets` 테이블과 사진용 `photos` 버킷을 둬요.
2. 페이지에서 `window.SKYLOG_CONFIG = { backend: 'cloud', cloud: { ... } }`를 `store.js`보다 먼저 설정해요.

모든 기록에 `observer`('a' 또는 'b')가 붙어 있어서, 두 사람의 기록이 한 곳에 나란히 쌓여요.

## 카탈로그 다시 만들기

```sh
npm pack d3-celestial@0.7.35 && tar xzf d3-celestial-0.7.35.tgz
python3 tools/build_catalog.py package/data js/catalog.js
```

별, 별자리, 심우주 천체, 은하수 데이터는 [d3-celestial](https://github.com/ofrohn/d3-celestial)(BSD-3-Clause, © 2015 Olaf Frohn)에서 가져왔어요. 행성 위치는 JPL 근사 궤도 요소로, 달은 저정밀 공식(약 0.3°)으로 계산해요.
