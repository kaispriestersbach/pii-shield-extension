# PII Shield – AI Privacy Guard

**Chrome Extension zum automatischen Schutz personenbezogener Daten (PII) bei der Nutzung von KI-Chatbots.**

PII Shield erkennt personenbezogene Daten in der Zwischenablage, bevor sie in einen KI-Chatbot eingefügt werden, und ersetzt sie automatisch durch realistische, aber fiktive Alternativen. Beim Kopieren der Chatbot-Antwort werden die Originaldaten nahtlos wiederhergestellt. Die gesamte Verarbeitung findet lokal im Browser statt – dank Chrome Built-in AI (Gemini Nano).

---

## Funktionsweise

Der Workflow von PII Shield lässt sich in drei Schritte unterteilen, die vollständig automatisch ablaufen:

| Schritt | Aktion | Beschreibung |
|---------|--------|--------------|
| **1. Einfügen** | `Ctrl+V` in den Chatbot | PII Shield fängt das Paste-Event ab, analysiert den Text mit Gemini Nano, erkennt PII und ersetzt sie durch plausible Fake-Daten. Der anonymisierte Text wird eingefügt. |
| **2. Verarbeitung** | Chatbot arbeitet | Der KI-Chatbot verarbeitet ausschließlich die anonymisierten Daten. Keine echten personenbezogenen Daten verlassen den lokalen Rechner. |
| **3. Kopieren** | Antwort markieren und kopieren | PII Shield erkennt beim Kopieren die Fake-Daten in der Antwort und stellt automatisch die Originaldaten in der Zwischenablage wieder her. |

### Beispiel

**Originaler Text (in der Zwischenablage):**
> Bitte erstelle eine E-Mail an Max Mustermann (max.mustermann@firma.de, Tel: +49 170 1234567) bezüglich des Vertrags für die Musterstraße 42, 10115 Berlin.

**Anonymisierter Text (wird in den Chatbot eingefügt):**
> Bitte erstelle eine E-Mail an Thomas Weber (t.weber@example.com, Tel: +49 151 9876543) bezüglich des Vertrags für die Lindenallee 7, 80331 München.

**Chatbot-Antwort (kopiert):**
> Sehr geehrter Herr Weber, bezüglich des Vertrags für die Lindenallee 7...

**Wiederhergestellter Text (in der Zwischenablage):**
> Sehr geehrter Herr Mustermann, bezüglich des Vertrags für die Musterstraße 42...

---

## Erkannte PII-Kategorien

PII Shield erkennt und anonymisiert die folgenden Kategorien personenbezogener Daten:

| Kategorie | Beispiele |
|-----------|-----------|
| **Namen** | Vor- und Nachnamen, vollständige Namen |
| **E-Mail-Adressen** | max.mustermann@firma.de |
| **Telefonnummern** | +49 170 1234567, 030/12345678 |
| **Physische Adressen** | Straße, PLZ, Stadt, Land |
| **Geburtsdaten** | 15.03.1985 |
| **Sozialversicherungsnummern** | Nationale ID-Nummern |
| **Kreditkartennummern** | VISA, Mastercard etc. |
| **IBAN / Bankdaten** | DE89 3704 0044 0532 0130 00 |
| **IP-Adressen** | 192.168.1.100 |
| **Firmennamen** | Wenn sie eine spezifische reale Firma identifizieren |

Die Erkennung erfolgt kontextbasiert durch Gemini Nano, nicht durch starre Regex-Muster. Dadurch werden auch ungewöhnliche Formate und kontextabhängige PII erkannt.

---

## Unterstützte Plattformen

PII Shield ist auf folgenden KI-Chatbot-Plattformen aktiv:

- **ChatGPT** – chatgpt.com / chat.openai.com
- **Claude** – claude.ai
- **Gemini** – gemini.google.com
- **Mistral** – chat.mistral.ai
- **Copilot** – copilot.microsoft.com
- **DeepSeek** – chat.deepseek.com

---

## Installation

### Voraussetzungen

PII Shield benötigt Chrome 138 oder neuer mit aktiviertem Gemini Nano. Die folgenden Chrome-Flags müssen aktiviert sein:

1. Öffne `chrome://flags/#optimization-guide-on-device-model` und setze den Wert auf **Enabled BypassPerfRequirement**.
2. Öffne `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` und setze den Wert auf **Enabled**.
3. Starte Chrome neu.
4. Öffne `chrome://components/` und prüfe, ob **Optimization Guide On Device Model** vorhanden ist. Klicke ggf. auf **Nach Updates suchen**, um das Modell herunterzuladen.

### Hardware-Anforderungen

| Anforderung | Minimum |
|-------------|---------|
| **Betriebssystem** | Windows 10/11, macOS 13+, Linux, ChromeOS |
| **Speicherplatz** | 22 GB frei im Chrome-Profil-Verzeichnis |
| **GPU** | > 4 GB VRAM |
| **CPU (ohne GPU)** | 16 GB RAM, 4+ Kerne |

### Extension laden

1. Öffne `chrome://extensions/` in Chrome.
2. Aktiviere den **Entwicklermodus** (oben rechts).
3. Klicke auf **Entpackte Erweiterung laden**.
4. Wähle den Ordner `pii-shield-extension` aus.
5. Die Extension erscheint in der Toolbar mit dem Schild-Icon.

---

## Architektur

PII Shield besteht aus drei Hauptkomponenten:

### 1. Content Script (`content.js`)

Das Content Script wird in die unterstützten Chatbot-Seiten injiziert und übernimmt zwei zentrale Aufgaben:

**Paste-Interception:** Das Script fängt das `paste`-Event in der Capture-Phase ab, bevor die Chatbot-Anwendung den Text verarbeitet. Der Text wird an den Service Worker zur PII-Analyse gesendet. Wird PII erkannt, wird der anonymisierte Text eingefügt; andernfalls der Originaltext.

**Copy-Interception:** Beim Kopieren von Text aus der Chatbot-Antwort prüft das Script, ob der kopierte Text bekannte Fake-Daten enthält. Falls ja, wird die Zwischenablage mit den wiederhergestellten Originaldaten überschrieben.

Zusätzlich zeigt das Content Script visuelle Benachrichtigungen (Banner) an und stellt ein schwebendes Badge-Icon bereit, über das die Extension schnell aktiviert oder deaktiviert werden kann.

### 2. Service Worker (`background.js`)

Der Service Worker ist das Herzstück der PII-Erkennung. Er verwaltet eine Gemini Nano Session über die Chrome Prompt API (`LanguageModel.create()`) und nutzt einen speziell konfigurierten System-Prompt, der das Modell anweist, PII zu identifizieren und ein JSON-Mapping von Original- zu Fake-Werten zurückzugeben.

Das Mapping wird pro Tab gespeichert (`Map<tabId, Map<fake, original>>`), sodass mehrere Tabs unabhängig voneinander arbeiten können. Bei Tab-Schließung wird das zugehörige Mapping automatisch bereinigt. Alle Mappings werden zusätzlich in `chrome.storage.local` persistiert.

### 3. Popup (`popup/`)

Das Popup bietet eine Übersicht über den aktuellen Status der Extension, die Verfügbarkeit von Gemini Nano und die aktiven Ersetzungen für den aktuellen Tab. Über einen Toggle kann die Extension aktiviert oder deaktiviert werden. Die Mapping-Tabelle aktualisiert sich automatisch alle 2 Sekunden.

### Datenfluss-Diagramm

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser Tab                           │
│                                                              │
│  ┌─────────┐   paste    ┌──────────────┐   anonymized text  │
│  │ Clipboard├──────────►│ Content Script├──────────────────► │
│  │ (Ctrl+V) │           │  (content.js) │    ┌───────────┐  │
│  └─────────┘            └──────┬────────┘    │  Chatbot   │  │
│                                │             │  Input     │  │
│                    sendMessage │             └───────────┘  │
│                                ▼                             │
│                    ┌───────────────────┐                     │
│                    │  Service Worker   │                     │
│                    │  (background.js)  │                     │
│                    │                   │                     │
│                    │  ┌─────────────┐  │                     │
│                    │  │ Gemini Nano │  │                     │
│                    │  │ (Prompt API)│  │                     │
│                    │  └─────────────┘  │                     │
│                    │                   │                     │
│                    │  ┌─────────────┐  │                     │
│                    │  │  Mapping    │  │                     │
│                    │  │  Storage    │  │                     │
│                    │  └─────────────┘  │                     │
│                    └───────────────────┘                     │
│                                ▲                             │
│                    sendMessage │                              │
│                                │                             │
│  ┌─────────┐    copy    ┌──────┴────────┐   de-anonymized   │
│  │ Clipboard│◄──────────┤ Content Script├◄──────────────── │
│  │ (Ctrl+C) │           │  (content.js) │    ┌───────────┐  │
│  └─────────┘            └───────────────┘    │  Chatbot   │  │
│                                              │  Response  │  │
│                                              └───────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Datenschutz & Sicherheit

PII Shield wurde mit einem strikten Privacy-by-Design-Ansatz entwickelt:

- **Keine Datenübertragung:** Alle PII-Analysen finden lokal im Browser statt. Gemini Nano läuft vollständig on-device – keine Daten werden an Google oder Dritte gesendet.
- **Keine externen Server:** Die Extension kommuniziert mit keinem externen Server. Es gibt kein Backend, keine Telemetrie, kein Tracking.
- **Minimale Berechtigungen:** Die Extension benötigt nur `storage` (für Mappings), `clipboardRead` und `clipboardWrite` sowie Host-Permissions für die unterstützten Chatbot-Seiten.
- **Tab-isolierte Mappings:** Jeder Tab hat sein eigenes Mapping. Bei Tab-Schließung werden die Daten automatisch gelöscht.

---

## Einschränkungen

- **Gemini Nano erforderlich:** Die Extension funktioniert nur in Chrome-Versionen, die die Prompt API unterstützen (Chrome 138+). Das Modell muss heruntergeladen sein.
- **KI-basierte Erkennung:** Da die PII-Erkennung durch ein Sprachmodell erfolgt, kann es zu False Positives (fälschlich erkannte PII) oder False Negatives (übersehene PII) kommen. Die Erkennung ist nicht deterministisch.
- **Textbasiert:** Aktuell werden nur Texteinfügungen über die Zwischenablage überwacht. Datei-Uploads werden nicht analysiert.
- **Latenz:** Die PII-Analyse durch Gemini Nano kann je nach Hardware 1–5 Sekunden dauern. Während dieser Zeit wird das Einfügen blockiert.

---

## Lizenz

MIT License – Frei verwendbar, modifizierbar und verteilbar.
