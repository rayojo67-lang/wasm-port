package com.example.wasmgame

import android.annotation.SuppressLint
import android.content.pm.ConfigurationInfo
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Trace
import android.util.DisplayMetrics
import android.view.Surface
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ── Fullscreen immersive mode ─────────────────────────────────────
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        )
        window.insetsController?.let {
            it.hide(WindowInsetsCompat.Type.systemBars())
            it.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        // ── Lock orientation (landscape for games) ────────────────────────
        requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE

        // ── WebView with maximum performance ──────────────────────────────
        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                cacheMode = WebSettings.LOAD_NO_CACHE
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

                // GPU rasterization + hardware layers
                setRenderPriority(WebSettings.RenderPriority.HIGH)
                if (Build.VERSION.SDK_INT >= 26) {
                    setOffscreenPreRaster(true)
                }

                // Enable WebGL (required for Unity/Three.js exports)
                // Note: WebView enables WebGL by default on API 26+
                // No explicit flag needed, but ensure HWA is on
            }

            // Force hardware layer (GPU compositing)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            // Background color: black (no white flash)
            setBackgroundColor(android.graphics.Color.BLACK)

            // ── WebChromeClient: console, progress, fullscreen ──────────
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(msg: android.webkit.ConsoleMessage): Boolean {
                    android.util.Log.d("WASM", "${msg.sourceId()}: ${msg.message()}")
                    return true
                }
                override fun onProgressChanged(view: WebView, progress: Int) {
                    // Optional: show loading progress
                }
                override fun onShowCustomView(view: View?, details: CustomViewCallback?) {
                    // Handle fullscreen video (if game uses <video>)
                    super.onShowCustomView(view, details)
                }
            }

            // ── WebViewClient: intercept, security, performance ──────────
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    // Block external navigation (game stays in WebView)
                    val url = request.url.toString()
                    if (url.startsWith("file:///android_asset")) return false
                    return true // block everything else
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    Trace.beginSection("wasm_page_start")
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    Trace.endSection()
                    // Inject performance hints after load
                    evaluateJavascript(
                        """
                        (function() {
                            // Force GPU compositing on canvas
                            const c = document.getElementById('game-canvas');
                            if (c) {
                                c.style.willChange = 'transform';
                                c.style.transform = 'translateZ(0)';
                            }
                        })();
                        """
                    )
                }

                override fun onReceivedError(
                    view: WebView, errorCode: Int, description: String?, failingUrl: String?
                ) {
                    android.util.Log.e("WASM", "Error $errorCode: $description at $failingUrl")
                }
            }

            loadUrl("file:///android_asset/web/index.html")
        }

        setContentView(webView)

        // ── Back button handling ──────────────────────────────────────────
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
                else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    // ── Lifecycle: freeze/resume JS timers ────────────────────────────────
    override fun onPause() {
        super.onPause()
        webView.onPause()
        webView.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    // ── Prevent screen sleep during gameplay ──────────────────────────────
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    // ── GPU capability check (log for debugging) ──────────────────────────
    private fun logGpuInfo() {
        val info = packageManager.getSystemAvailableFeatures()
        val hasGles3 = info.any { it.name == "android.hardware.opengles.a3" }
        val hasGles2 = info.any { it.name == "android.hardware.opengles.a2" }
        android.util.Log.i("WASM", "GLES3=$hasGles3 GLES2=$hasGles2")
    }

    companion object {
        private val Build = android.os.Build
    }
}   
