# Training the PII model on Kaggle

The full run takes about 30 minutes, most of it waiting. You'll need a Kaggle account and a Hugging Face account; both are free.

## 1. Create a Hugging Face write token (once)

1. Sign in at https://huggingface.co → avatar → **Settings → Access Tokens → Create new token**.
2. Choose **Write**, name it `mintx`, and copy it.
3. Keep it private. Don't paste it into chat, code or GitHub. It goes only into the places below.

## 2. Upload the dataset to Hugging Face (from your PC)

In PowerShell, from the project folder:

```powershell
python -m pip install -r ml/requirements.txt huggingface_hub
python ml/data/fetch_ai4privacy.py      # skip if ml/data/raw/ already exists
python ml/data/build.py                 # skip if ml/data/processed/ already exists
$env:HF_TOKEN = "paste-your-token-here"
python ml/push_dataset.py --repo YOUR_HF_USERNAME/mintx-pii
```

When it finishes, it prints a link such as `https://huggingface.co/datasets/YOUR_HF_USERNAME/mintx-pii`. Open it to check the files are there.

## 3. Set up the Kaggle notebook

1. Sign in at https://www.kaggle.com and **verify your phone number** (Settings → Phone verification). Without this, GPUs are locked.
2. **Create → New Notebook → File → Import Notebook**, and upload `ml/train_ner.ipynb`.
3. In the right-hand panel:
   - **Session options → Accelerator → GPU T4 x2** (or P100)
   - **Session options → Internet → On**
4. **Add-ons → Secrets → Add Secret**: label `HF_TOKEN`, value = your token. Tick the box so the notebook can use it.

## 4. Edit the configuration cell

Change only these two lines to your Hugging Face username:

```python
HF_DATASET    = "YOUR_HF_USERNAME/mintx-pii"
HF_MODEL_REPO = "YOUR_HF_USERNAME/mintx-pii-distilbert"
```

## 5. Run

Click **Run All**, or use **Save Version → Save & Run All (Commit)** so it keeps running in the background after you close the tab.

| Stage | Time on a T4 |
| --- | --- |
| Install and load data | ~2 min |
| Fine-tuning (3 epochs) | ~15–20 min |
| Evaluation and baseline | ~3 min |
| ONNX export, quantization, upload | ~3 min |

## 6. Send back the results

At the end you'll see `📦 download this and send me results.json`. In the Output panel on the right, download **`mintx-pii-distilbert_results.zip`** and share `results.json` (and the two charts if you like). From those I'll:

- write the results into the README and your report,
- connect the extension to your model on Hugging Face,
- re-run the browser tests to measure the real-world gain.

## Optional: second experiment (model comparison)

Run the notebook again with:

```python
BASE_MODEL    = "dslim/bert-base-NER"      # starts from a model that already knows names (transfer learning)
RUN_NAME      = "mintx-pii-bert"
HF_MODEL_REPO = "YOUR_HF_USERNAME/mintx-pii-bert"
LR            = 3e-5
```

Comparing the two `results.json` files gives you a model-comparison table for the report.

## If something goes wrong

| Message | Fix |
| --- | --- |
| `⚠️ No GPU found` | Accelerator is off, or the phone isn't verified |
| `401` / `Repository not found` while loading data | The `HF_DATASET` name is wrong, or the dataset is private and the `HF_TOKEN` secret isn't attached |
| `Add an HF_TOKEN secret…` | The secret is missing or not ticked for this notebook |
| `CUDA out of memory` | Set `BATCH = 16` |
