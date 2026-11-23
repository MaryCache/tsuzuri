"""追加の依存なしで実行する画面の回帰試験。"""

from pathlib import Path
import shutil
import subprocess
import unittest


class WebTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "画面の回帰試験には Node.js が必要")
    def test_rendering_and_comment_requests(self):
        """差込み・履歴・退役文・推敲・送信内容・起動案内を確認する。"""
        subprocess.run(["node", str(Path(__file__).with_name("web_checks.cjs"))], check=True, timeout=10)
