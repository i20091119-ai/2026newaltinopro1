# BLE 동시성 시험대 (JVM)

`AltinoBle.kt` 를 **고치지 않고 그대로** JVM 에서 돌려 스레드 동작을 재는 장치다.
실기 없이 확인할 수 있는 건 여기까지이고, 실제 로봇·태블릿 확인을 대신하지는 않는다.

## 왜 만들었나
API 33+ 의 `writeCharacteristic` 은 결과값을 돌려주는 **동기 바인더 호출**이라,
부른 스레드가 블루투스 프로세스의 응답을 기다린다. 예전 코드는 그 호출을
`sendFrame` 을 부른 스레드(WebView JavaBridge)에서, 그것도 **락을 쥔 채로** 했다.
12대가 붐벼 스택이 밀리면 `sendFrame` 이 멈추고 → JS 가 그 반환을 기다리므로
→ 게임 화면 전체가 같은 시간만큼 얼어붙었다. 눈으로는 "가끔 버벅인다" 로만 보인다.

## 무엇을 재는가
- `Harness.kt` — 스택이 N ms 밀릴 때
  - sendFrame 이 최대 몇 ms 막히는가 (그동안 웹 화면이 멈춘다)
  - 메인 스레드가 최대 몇 ms 막히는가 (5초 넘으면 ANR)
  - GATT 호출이 동시에 2개 뜬 적이 있는가 (1이어야 정상)
  - 실제로 나간 프레임 수
- `Stress.kt` — 고친 뒤 다른 게 깨지지 않았는지 13가지
  (연결 절차 순서, 직렬성, 무응답 중 큐 생존, 복구 속도, 좀비링크 감지,
   연결/해제 반복 중 예외·데드락, 스레드 누수)

## 돌리는 법
```sh
# 1) 컴파일러·표준 라이브러리 받기 (한 번만)
mkdir -p lib && cd lib
for a in kotlin-compiler-embeddable kotlin-stdlib kotlin-reflect kotlin-script-runtime kotlin-daemon-embeddable; do
  curl -sLO "https://repo1.maven.org/maven2/org/jetbrains/kotlin/$a/2.0.21/$a-2.0.21.jar"
done
curl -sL "https://repo1.maven.org/maven2/org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar" -o trove4j.jar
curl -sL "https://repo1.maven.org/maven2/org/jetbrains/annotations/24.1.0/annotations-24.1.0.jar" -o annotations.jar
curl -sL "https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.8.1/kotlinx-coroutines-core-jvm-1.8.1.jar" -o coroutines.jar
cd ..

# 2) 진짜 소스를 가져와 함께 컴파일
cp ../../android/app/src/main/java/saeon/altino/webctrl/AltinoBle.kt .
CP=$(ls lib/*.jar | tr '\n' ':')
java -cp "$CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -nowarn -no-stdlib -no-reflect \
     -d out *.kt -cp lib/kotlin-stdlib-2.0.21.jar

# 3) 실행
java -Dstdout.encoding=UTF-8 -cp "out:lib/kotlin-stdlib-2.0.21.jar" harness.Main 300 "지금"
java -Dstdout.encoding=UTF-8 -cp "out:lib/kotlin-stdlib-2.0.21.jar" harness.Stress
```

## 남긴 교훈
`늦은 콜백 세기`(워치독이 건너뛴 op 의 뒤늦은 콜백을 개수로 세어 삼키기)를
넣었다가 여기서 걸러내고 되돌렸다. 안드로이드 GATT 콜백에는 우리가 붙인 번호가
없어 늦은 콜백과 정상 콜백을 구별할 수 없고, 세기만 하면 로봇이 잠깐 응답을
안 한 뒤 그 수가 쌓여 **복구가 2초에 한 건씩 기어간다**(실측: 정상 대비 2초에 1회).
