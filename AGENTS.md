# AGENTS.md

このリポジトリで作業するコーディングエージェント向けのガイドです。

## プロジェクト概要

- MediaPipe（`@mediapipe/tasks-vision`）のみでトラッキングするブラウザ向けモーションキャプチャアプリ。
- ブラウザで姿勢・顔・手を検出し、ワイヤーフレーム描画、アバター向けJSON出力、ローカルVRMプレビュー、WebSocket送信を行う。
- ブラウザはUDP/OSCを直接送れないため、WebSocketを受けてVMC Protocol OSCへ変換するローカルブリッジ（`bridge/`）を同梱する。
- 本番はCloudflare（Wrangler）に静的アセットをSPAとしてデプロイする。

## 構成 / エントリポイント

- `index.html`: アプリのUIシェルと各コントロール要素。
- `src/main.ts`: エントリポイント。カメラ制御、MediaPipeトラッカー、ワイヤー描画、モーションJSON生成、WebSocket送信、`localStorage`設定保存。
- `src/vrm-viewer.ts`: `three` / `@pixiv/three-vrm` によるVRMプレビューとモーション→ボーンのリギング。
- `src/motion-types.ts`: `MotionSnapshot` などの共有型定義（`main.ts` と `bridge` の暗黙のスキーマ）。
- `src/style.css`: UIスタイル。
- `bridge/vmc-bridge.mjs`: WebSocket→VMC OSCブリッジ兼 `dist/` の静的配信サーバー。
- `bridge/verify-vmc-bridge.mjs`: ブリッジのエンドツーエンド検証スクリプト。
- 設定ファイル: `vite.config.ts`（devサーバは `127.0.0.1:5173`）、`tsconfig.json`（`strict` / `noEmit`）、`wrangler.jsonc`。

## セットアップ

- 依存インストール: `npm install`（Node.js 20 以上を推奨）。
- 開発サーバ: `npm run dev`（`http://127.0.0.1:5173`）。カメラはセキュアコンテキスト（`localhost` / `https`）が必要。
- MediaPipeのWASMと `.task` モデルは実行時に外部CDN（`cdn.jsdelivr.net` / `storage.googleapis.com`）から取得するため、ネットワークが必要。

## ビルド / テスト / lint / typecheck

- ビルド: `npm run build`（`tsc` による型チェック後に `vite build` で `dist/` を生成）。
- 型チェック: 専用スクリプトはなく、`npm run build` 内の `tsc`（`noEmit`）が型チェックを兼ねる。
- lint / ユニットテスト: 専用の lint・テストランナーは未設定（ESLint/Prettier/テストフレームワークは無し）。
- 検証（E2E相当）: `npm run verify`（ビルド後に `verify:bridge` を実行）。一時ブリッジを起動し、WebSocketにサンプルモーションを送って root / body bone / finger bone / blendshape / status のOSCが出ることを確認する。`verify:bridge` 単体は既存の `dist/` が前提。
- プレビュー: `npm run preview`。
- デプロイ: `npm run deploy`（`build` 後に `wrangler deploy`。Cloudflare認証が必要）。

## 開発フロー

- 思考は英語で行い、ユーザーへの回答は日本語で行う。
- コーディングタスクでは、提案だけで終わらず、必要な変更・検証・報告まで進める。
- 既存の設計・命名・UI方針を優先し、不要なリファクタリングを混ぜない。
- 変更前に関連ファイルを読む。
- ユーザーや生成済みの未コミット変更を勝手に戻さない。
- 小さな変更でも、可能な範囲で `npm run build` または `npm run verify` を実行する。
- VMCブリッジやWebSocket出力に影響する変更では `npm run verify` を優先する。
- デプロイ前は `npm run verify` が通る状態にする。本番反映は `npm run deploy` を使う。

## コーディング規約

- TypeScriptは `strict` 前提。`any` や場当たりの型回避を避け、型を理解してから正しくアクセスする。
- インデントは2スペース、文字列はダブルクォート、文末はセミコロンあり（既存コードに合わせる）。
- モーションのデータ形状は `src/motion-types.ts` を基準にし、`main.ts` の出力・`bridge` の入力・検証スクリプトの三者で整合させる。
- 出力JSONの `schema`（例 `mediapipe-motion.v1`、`mediapipe-motion.bridge.v1`）を変更する場合は関係箇所すべてを揃える。

## VRM / モーション調整

- `.vrm` ファイルはローカル検証用アセットとして扱い、Gitには含めない（`.gitignore` 済み）。
- VRMプレビューでは、モデル固有のローカル軸差を考慮する。
- MediaPipe由来の既存 `rotation` は互換性維持のため残し、VRMプレビュー向けの補助値は追加フィールドで拡張する。
- VMCブリッジのOSC出力スキーマを変える場合は、READMEと検証スクリプト（`bridge/verify-vmc-bridge.mjs`）も更新する。

## 注意点 / コミット・配信

- コミット前に `git status --short` で追跡対象を確認する。
- 大容量のローカルモデル、`dist/`、`node_modules/`、`.wrangler/` はコミットしない。
- 生成物（`dist/`）を手で編集せず、必ずビルドで生成する。
- push後にデプロイし、失敗した場合は原因と未完了作業を明示する。
