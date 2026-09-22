package net.ayin.shell

import android.content.ComponentCallbacks2
import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.webkit.CookieManager
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShellBaselineInstrumentedTest {
    @Test
    fun bridgeDpadMediaBackFullscreenAndLifecycleStayShared() {
        launch().use { scenario ->
            loadHarness(scenario)
            assertTrue(awaitJsBoolean(scenario, "typeof window.AyinNative === 'object'"))
            assertEquals(
                JSONObjectQuote(BuildConfig.SHELL_PLATFORM),
                evaluateJavascript(scenario, "window.AyinNative.getPlatform()"),
            )

            InstrumentationRegistry.getInstrumentation()
                .sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            assertTrue(awaitJsBoolean(scenario, "window.__lastRemote === 'PLAY_PAUSE'"))

            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            assertTrue(awaitJsBoolean(scenario, "window.__lastKeyCode === 39"))

            evaluateJavascript(
                scenario,
                "window.AyinNative.setFullscreen(true); true",
            )
            assertTrue(awaitActivity(scenario) { it.shellFullscreenForTests() })
            evaluateJavascript(
                scenario,
                "window.AyinNative.setFullscreen(false); true",
            )
            assertTrue(awaitActivity(scenario) { !it.shellFullscreenForTests() })

            evaluateJavascript(
                scenario,
                """
                window.addEventListener('ayin:native-remote', (event) => {
                  if (event.detail.key === 'BACK') {
                    window.__backConsumed = true;
                    event.preventDefault();
                  }
                }, { once: true });
                true
                """.trimIndent(),
            )
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            assertTrue(awaitJsBoolean(scenario, "window.__backConsumed === true"))
            scenario.onActivity { assertFalse(it.isFinishing) }

            scenario.moveToState(Lifecycle.State.CREATED)
            scenario.moveToState(Lifecycle.State.RESUMED)
            assertTrue(awaitJsBoolean(scenario, "window.__lastLifecycle === 'resume'"))

            scenario.onActivity {
                it.onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL)
            }
            assertTrue(awaitJsBoolean(scenario, "window.__lastLifecycle === 'memory-pressure'"))

            scenario.onActivity { it.emitNetworkForTests(false) }
            assertTrue(awaitJsBoolean(scenario, "window.__lastNetwork === false"))
            scenario.onActivity { it.emitNetworkForTests(true) }
            assertTrue(awaitJsBoolean(scenario, "window.__lastNetwork === true"))
        }
    }

    @Test
    fun cookieSessionAndRendererRecoverySurviveActivityChanges() {
        launch().use { scenario ->
            val cookies = CookieManager.getInstance()
            scenario.onActivity {
                cookies.setCookie(
                    BuildConfig.AYIN_ORIGIN,
                    "ayin_task77_session=baseline; Path=/; Secure; SameSite=Lax",
                )
                cookies.flush()
            }
            scenario.recreate()
            assertTrue(
                CookieManager.getInstance()
                    .getCookie(BuildConfig.AYIN_ORIGIN)
                    .orEmpty()
                    .contains("ayin_task77_session=baseline"),
            )

            var before = 0
            scenario.onActivity {
                before = System.identityHashCode(it.webView)
                it.simulateRendererRecoveryForTests()
            }
            assertTrue(
                awaitActivity(scenario) {
                    System.identityHashCode(it.webView) != before
                },
            )
            assertTrue(
                CookieManager.getInstance()
                    .getCookie(BuildConfig.AYIN_ORIGIN)
                    .orEmpty()
                    .contains("ayin_task77_session=baseline"),
            )
        }
    }

    @Test
    fun deepLinksStayCanonical() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val deepLink =
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("ayin://live/task-77?autoplay=1"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        ActivityScenario.launch<MainActivity>(deepLink).use { scenario ->
            scenario.onActivity {
                assertEquals(
                    "https://ayin.stream/live/task-77?autoplay=1",
                    it.lastTrustedUrlForTests(),
                )
            }
        }
    }

    @Test
    fun googleTvDirectBackExitsInOnePressWhenRequested() {
        if (!ShellNavigation.isTvPlatform()) return
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val deepLink =
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("ayin://live/task-77?exit_on_back=true"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        ActivityScenario.launch<MainActivity>(deepLink).use { scenario ->
            scenario.onActivity {
                it.onBackPressedDispatcher.onBackPressed()
                assertTrue(it.isFinishing)
            }
        }
    }

    private fun launch(): ActivityScenario<MainActivity> {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        return ActivityScenario.launch(
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun loadHarness(scenario: ActivityScenario<MainActivity>) {
        scenario.onActivity {
            it.loadTestHtmlForTests(
                """
                <!doctype html>
                <html>
                  <body>
                    <button id="first" autofocus>First</button>
                    <button id="second">Second</button>
                    <script>
                      window.__lastRemote = null;
                      window.__lastLifecycle = null;
                      window.__lastKeyCode = null;
                      window.__lastNetwork = null;
                      window.__backConsumed = false;
                      window.addEventListener('ayin:native-remote', (event) => {
                        window.__lastRemote = event.detail.key;
                      });
                      window.addEventListener('ayin:native-lifecycle', (event) => {
                        window.__lastLifecycle = event.detail.state;
                      });
                      window.addEventListener('ayin:native-network', (event) => {
                        window.__lastNetwork = event.detail.online;
                      });
                      window.addEventListener('keydown', (event) => {
                        window.__lastKeyCode = event.keyCode;
                      });
                      document.getElementById('first').focus();
                    </script>
                  </body>
                </html>
                """.trimIndent(),
            )
        }
        assertTrue(awaitJsBoolean(scenario, "document.readyState === 'complete'"))
        scenario.onActivity { it.webView.requestFocus() }
    }

    private fun awaitJsBoolean(
        scenario: ActivityScenario<MainActivity>,
        expression: String,
        timeoutMs: Long = 5_000,
    ): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            if (evaluateJavascript(scenario, expression) == "true") return true
            Thread.sleep(50)
        }
        return false
    }

    private fun evaluateJavascript(
        scenario: ActivityScenario<MainActivity>,
        expression: String,
    ): String {
        val latch = CountDownLatch(1)
        var result = "null"
        scenario.onActivity {
            it.webView.evaluateJavascript(expression) { value ->
                result = value
                latch.countDown()
            }
        }
        assertTrue("JavaScript evaluation timed out", latch.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitActivity(
        scenario: ActivityScenario<MainActivity>,
        predicate: (MainActivity) -> Boolean,
        timeoutMs: Long = 5_000,
    ): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            var matched = false
            scenario.onActivity { matched = predicate(it) }
            if (matched) return true
            Thread.sleep(50)
        }
        return false
    }

    private fun JSONObjectQuote(value: String): String =
        """ + value.replace("\\", "\\\\").replace(""", "\\"") + """
}
