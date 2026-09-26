package io.github.shimucheng12art.yuan;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 余安 · Android 壳
 * 以 WebView 加载线上版 https://shimucheng12-art.github.io/yu-an/
 * - 保持同源：云端账号（碎碎念登录/日记分享）CORS 不受影响
 * - DOM Storage 开启：localStorage 正常持久化
 * - 文件选择：私聊发送图片/文件
 * - 下载：私聊文件气泡（data: 链接）保存到系统「下载」
 * - 断网：显示 assets/offline.html 轻量离线页
 */
public class MainActivity extends Activity {

    private String homeUrl;
    private static final int REQ_FILE = 42;

    private WebView web;
    private ValueCallback<Uri[]> fileCb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        homeUrl = getString(R.string.home_url);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String sch = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
                if (sch.equals("http") || sch.equals("https") || sch.equals("about")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    int c = err.getErrorCode();
                    if (c == ERROR_HOST_LOOKUP || c == ERROR_CONNECT || c == ERROR_TIMEOUT || c == ERROR_UNKNOWN) {
                        v.loadUrl("file:///android_asset/offline.html");
                    }
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(p.createIntent(), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                saveDataUrl(url, cd);
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(homeUrl);
    }

    /* 把私聊里 data: 链接的文件保存到系统「下载」 */
    private void saveDataUrl(String url, String contentDisposition) {
        try {
            if (url == null || !url.startsWith("data:")) {
                Toast.makeText(this, "暂不支持该类型的下载", Toast.LENGTH_SHORT).show();
                return;
            }
            int comma = url.indexOf(',');
            if (comma < 0) return;
            String meta = url.substring(5, comma);
            String payload = url.substring(comma + 1);
            boolean isB64 = meta.toLowerCase(Locale.US).contains("base64");
            String mime = meta.split(";")[0].trim();
            if (mime.isEmpty()) mime = "application/octet-stream";
            byte[] bytes = isB64 ? Base64.decode(payload, Base64.DEFAULT) : payload.getBytes("UTF-8");

            String name = "余安-" + new SimpleDateFormat("MMdd-HHmmss", Locale.US).format(new Date())
                    + extOf(mime, contentDisposition);

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                Uri out = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (out == null) throw new IllegalStateException("无法创建下载文件");
                OutputStream os = getContentResolver().openOutputStream(out);
                if (os == null) throw new IllegalStateException("无法打开输出流");
                try { os.write(bytes); } finally { os.close(); }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists()) dir.mkdirs();
                try {
                    FileOutputStream fo = new FileOutputStream(new File(dir, name));
                    try { fo.write(bytes); } finally { fo.close(); }
                } catch (Exception e2) {
                    dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) dir = getFilesDir();
                    FileOutputStream fo = new FileOutputStream(new File(dir, name));
                    try { fo.write(bytes); } finally { fo.close(); }
                    Toast.makeText(this, "已保存到 " + dir, Toast.LENGTH_LONG).show();
                    return;
                }
            }
            Toast.makeText(this, "已保存到「下载」：" + name, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "保存失败，请重试", Toast.LENGTH_SHORT).show();
        }
    }

    /* 依据 MIME 推断扩展名；优先取 Content-Disposition 的文件名 */
    private String extOf(String mime, String cd) {
        if (cd != null) {
            int i = cd.indexOf("filename=");
            if (i >= 0) {
                String f = cd.substring(i + 9).replace("\"", "").trim();
                int dot = f.lastIndexOf('.');
                if (dot > 0 && dot < f.length() - 1) return f.substring(dot);
            }
        }
        if (mime.contains("jpeg")) return ".jpg";
        if (mime.contains("png")) return ".png";
        if (mime.contains("gif")) return ".gif";
        if (mime.contains("webp")) return ".webp";
        if (mime.contains("pdf")) return ".pdf";
        if (mime.contains("zip")) return ".zip";
        if (mime.contains("json")) return ".json";
        if (mime.contains("xml")) return ".xml";
        if (mime.contains("html")) return ".html";
        if (mime.contains("wordprocessingml")) return ".docx";
        if (mime.contains("msword")) return ".doc";
        if (mime.contains("spreadsheetml")) return ".xlsx";
        if (mime.contains("ms-excel")) return ".xls";
        if (mime.contains("presentationml")) return ".pptx";
        if (mime.contains("ms-powerpoint")) return ".ppt";
        if (mime.contains("plain") || mime.contains("text")) return ".txt";
        return ".bin";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCb != null) {
                fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCb = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }
}
