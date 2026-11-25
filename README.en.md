# tsuzuri

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo/tsuzuri-lockup-white.svg">
  <img alt="tsuzuri" src="assets/brand/logo/tsuzuri-lockup.svg" width="420">
</picture>

日本語版は [README.md](README.md) にあります。

tsuzuri is a skill for AI coding agents (such as Claude Code, Codex, and Antigravity) and a viewer app for improving the quality of Japanese text written by AI.
Before writing each sentence, the AI records what the sentence should do for the reader as its writing intent (執筆意図), and after writing it, the AI tags the sentence with its sentence functions (文機能): labels such as its role, its connection to the previous sentence, and its importance.
In the viewer app, you read each sentence together with its writing intent and sentence functions, leave comments on sentences that drift from what you meant, and ask the AI to revise them.

This README was also written with tsuzuri.
This README explains why tsuzuri has the AI write its writing intent first, how to use it, and which papers and sources its rules are based on, in that order.

## Japanese text only

tsuzuri is made for writing and reviewing Japanese text (in both Markdown and LaTeX); apart from this README, it has not been tested on English.
The viewer app and its quick start guide are also in Japanese.
In this README, each screen name is given in English followed by the Japanese label shown on the screen.

## Why the AI writes its writing intent first

I built tsuzuri because I believe that when AI writes a whole text, the further the work gets from a person's hands, the worse the result becomes.

Before writing each sentence, tsuzuri has the AI write that sentence's writing intent first.
You can then read, for each sentence, its role and what the AI was thinking when it wrote it.
Because the writing intent and sentence functions have already laid out what each sentence needs to do and what qualities it should have, it is also easier for you to propose a better sentence yourself.

## What happens when you write with tsuzuri

When you ask your AI coding agent to "write with tsuzuri" (tsuzuri で書いて), the AI works in this order:

1. It writes a requirements document (要件定義書) that decides what to write, for whom and why, what to cover and what to leave out, and what the reader should be able to do afterward.
2. It writes a design document (設計書) that decides the claim and order of each paragraph.
3. It writes one sentence at a time, in the order of writing intent, sentence, and sentence functions.
4. It reviews the finished text by checking whether each sentence fulfills its writing intent, and applies the suggested improvements itself.
5. It makes the wording consistent, using the same term for the same thing, following a proofreading dictionary of preferred terms (built in, plus any you add), then polishes the phrasing with yomiyasu, a skill for revising Japanese prose.
6. It then has a separate AI read the text without the design document or the writing intents, and fixes the places where that reader gets stuck.

In step 4, the AI does not apply a suggestion that needs facts outside the source material or that would change the meaning, a number, the certainty or the strength of a claim; it tells you why instead.
If you ask it to stop after the requirements or the design, the AI stops there, and you can comment on those documents too.

## Reading and asking for revisions in the viewer app

Open the finished text in the viewer app and select a sentence; its writing intent and sentence functions appear in the detail panel (詳細パネル) on the right.
If a sentence looks wrong, leave a comment on it and ask your AI coding agent to "read the tsuzuri comments and revise" (tsuzuri のコメントを読んで直して); the AI then revises the sentence and adds it as a new version.

Each new version gets a one-line title saying what was changed, which appears in the version history when you select the sentence.
The earlier version stays in the record (see "Where the record is kept, and git"), so you can check the difference in the app.

## Reading text written by people or other AIs

Text written by a person or by another AI can be read with tsuzuri too: ask your AI coding agent to "read this with tsuzuri" (tsuzuri で読んで), and the AI tags it with sentence functions one sentence at a time.
Such text has no writing intent from its author, so the AI adds one it infers from the sentence and its context, and the app marks it as inferred.

When it reads text that you or someone else wrote, the AI also reviews it and points out weak sentences, and you can ask it to revise them.
It does not revise them on its own, though; for text you are in a position to revise, such as your own draft, it asks you first whether to apply its suggested fixes.

To read a wordy AI-written article with less effort, choose the filter (フィルター) to the right of the importance (重要度) heading in the sidebar and press nucleus (核, the sentences whose removal would lose the main point): only those sentences remain, so you can follow the main line.

For text written by another chat AI, open the library (ライブラリ, the screen that switches between texts, templates, the proofreading dictionary and prompts; the 0 key) in the app, switch to prompts (プロンプト), copy the prompt that asks the AI to write out how it wrote the text, and send it in the conversation where that text was written.
Give the answer to your AI coding agent together with the text, and it records writing intents from the writing AI's own account rather than from guesses.

## Templates and the proofreading dictionary

Templates and the proofreading dictionary are where you keep your rules and preferences for tsuzuri; the more you add, the closer the first draft gets to your taste (see "A reading aid that helps you put your taste into words" in the design rationale).

A template sets out, for one kind of text, when to use it, the default length and register, and the outline of headings.
tsuzuri ships four: README, 仕事の報告と提案 (work reports and proposals), ブログとエッセイ (blogs and essays), and 論文（LaTeX） (LaTeX papers).
If you name one when you ask, as in "use the README template", the AI follows it.
If you do not, it picks the template closest to the request, and writes without one when none fits.

For text whose headings are fixed, such as your company's articles, put your own template in `~/.config/tsuzuri/templates/`.
The file name becomes the template's name, and you pick it by that name.
To write one, copy a default template from `skills/tsuzuri/references/templates/` and edit it.
You can also hand over a text you want to follow and ask the AI to "make a template from this text" (この文章をもとにテンプレートを作って); it reads the use, register and heading outline and writes the template for you.
If yours has the same name as a default template, yours is used instead.

You can add your own preferred terms, and the names you use in a particular text, to the proofreading dictionary used in step 5 of "What happens when you write with tsuzuri".
Write them in `~/.config/tsuzuri/words.tsv`, one per line, as a pattern, a replacement and a note separated by tabs; they are used together with the built-in dictionary.
When a comment asks for a rewording that other texts are likely to need too, the AI adds a line to your dictionary itself and tells you it did.

If you need connection words (how a sentence links to the previous one) or role words (what a sentence does) beyond the defaults, add them to `vocab.json` in each text's record folder (see "Where the record is kept, and git").
You can browse your templates and proofreading dictionary, and read their contents, by switching views in the app's library (ライブラリ).

## Installation

You need a skills-compatible AI coding agent (such as Claude Code, Codex, or Antigravity), Python 3.10 or later, and yomiyasu, plus Node.js (for npx) and git to install the skills and clone the repository.
Install the skills with these commands:

```bash
npx skills add MaryCache/tsuzuri
npx skills add nanaism/yomiyasu
```

The viewer app is not part of the skill, so clone the repository as well, and start the app:

```bash
git clone https://github.com/MaryCache/tsuzuri.git
python3 tsuzuri/app/server.py
```

Open the address it prints in your browser; on first launch, the app opens a quick start guide in Japanese, itself written with tsuzuri.
To open a record folder (the `<file name>.tsuzuri` folder described in "Where the record is kept, and git") that is not in your library, pass it, as in `python3 tsuzuri/app/server.py <file name>.tsuzuri`; `--port` changes the port (8770 by default), and `--image-root` sets the allowed root directory for relative images (the git repository root by default).

To try it on your own text, tell your AI coding agent what you want to write and for whom, and ask it to write with tsuzuri; the result appears in the app's library (ライブラリ, the 0 key).

## Where the record is kept, and git

The requirements document, the design document, each sentence's writing intent and sentence functions, and your comments are kept as a record in a folder named "<file name>.tsuzuri" next to the text file.
tsuzuri adds `*.tsuzuri/` to the `.gitignore` of the repository that holds the text file, so the record is excluded from git by default.

If you commit the record and publish it, your writing intents and comments are published too.
If you keep it out of git and delete the folder, git cannot restore it.
To keep your writing intents and comments without publishing them, back up the record folder separately.

## Sharing a record

To share a record, ask your AI coding agent to "pack this text's record into a shared file" (この文章の記録を共有ファイルにまとめて); the record and the text are packed into one shared file (`.tsz`).
The recipient opens it with the open-shared-file button (共有ファイルを開く) to the right of the library heading in the app, or by dragging the file onto the library.

A shared file also contains your writing intents and comments, so check that they are fine to share before you send it.

## Design rationale

### A reading aid that helps you put your taste into words

Out of the box, tsuzuri does not finish your text exactly to your taste.
It is first of all a reading aid: it makes the text easy for a person to review.

tsuzuri gives you two things: readable Japanese text that is considered correct and has few quirks, and the thinking behind each sentence at the time it was written (its writing intent).
Turning that into the text you like is your job, and tsuzuri does not try to have the AI anticipate every small preference in wording.
In return, because you can compare each sentence with the thinking behind it, it becomes far easier to point at the sentences that differ from the best text you can imagine and put the difference into words.

Before it writes again, the AI reads the before and after versions of sentences you fixed through comments as examples.
On top of that, the AI adds the rewordings you ask for in comments to the proofreading dictionary, and you can add the outlines you always use to templates (see "Templates and the proofreading dictionary"), so the first draft keeps getting better the more you use tsuzuri.

### Deciding the requirements and design first

Deciding the purpose before the structure is the order taught both in technical writing courses (Google Technical Writing) and in Japanese composition teaching (Kaneko 2003).
In one experiment, deciding the order before writing improved text quality as much when the outline was kept in the head as when it was written on paper (Kellogg 1988).

Another study found that the effect of planning instruction varied by aspect, with no effect on the quality of the theme (主題), the main point a text sets out to convey (Takahashi).
tsuzuri therefore checks the quality of the theme by asking, for each item of the requirements document, what the reader gains from it.

### What tsuzuri asks of a writing intent

For each sentence's writing intent, tsuzuri asks what the reader gains when the intent is fulfilled, that is, whether the sentence answers the reader's "So what?"
In narrative research, the part that answers the listener's "So what?" is called the evaluation, and it shows that the story is worth telling (Labov).

An intent that cannot answer it often simply reflects the order in which ideas occurred to the writer (Flower 1979 called text ordered by the writer's convenience rather than the reader's needs writer-based prose).
tsuzuri therefore has the AI rewrite an intent that cannot answer it, starting from what the reader gains.

### The sentence-function vocabulary

The connection labels come from Ichikawa Takashi's (1978) eight types of links between sentences, and the role labels come from Kido Mitsuko's (1992) six categories for newspaper letters.
Importance has two values, the nucleus, whose removal would lose the main point, and the satellite, which supports it, taken from the RST annotation manual (Carlson & Marcu 2001).

Studies report that even people often disagree on how sentences relate and which ones matter most (Prasad et al. 2017; Zeldes et al. 2026).
tsuzuri therefore does not treat sentence functions as correct answers; they are a guide that you can correct with a comment when you disagree.

### Checking the load on the reader

People who read only a summary of the main points of a textbook chapter remembered those points and answered inference questions better than people who read the full chapter, and the advantage lasted 6 to 12 months (Reder & Anderson 1980).
In other words, adding satellite detail does not always deepen understanding.

In a Japanese study, readers answered questions about a sentence faster when the sentence carried one point instead of several (Yoshida & Nakayama 2002).
Among the studies I found, none sets a number for how much to cut, so tsuzuri only points out long sentences and paragraphs with many satellites as candidates to reconsider.

### Reading by a reader without context

Writers know their own intentions too well to notice where readers will stumble (Caltech Hixon Writing Center).
Writers taught with records of real readers' responses became significantly better at taking the reader's point of view (Schriver 1994).
tsuzuri therefore has a separate AI without the writing context report where it stumbles, and revises the text from that response.

Full references, including sources not cited above, are in the skill's `skills/tsuzuri/references/` files, which are written in Japanese.
