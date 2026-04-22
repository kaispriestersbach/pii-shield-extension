# PII Shield – AI Privacy Guard

**Chrome Extension zum automatischen Schutz personenbezogener Daten (PII) bei der Nutzung von KI-Chatbots.**

PII Shield erkennt personenbezogene Daten in der Zwischenablage, bevor sie in einen KI-Chatbot eingefügt werden, und ersetzt sie automatisch durch realistische, aber fiktive Alternativen. Beim Kopieren der Chatbot-Antwort werden bekannte Fake-Daten wiederhergestellt. Die Verarbeitung findet lokal im Browser statt – mit Chrome Built-in AI (Gemini Nano) und deterministischen Prüfern für strukturierte Daten.

---

## Funktionsweise

Der Workflow von PII Shield lässt sich in drei Schritte unterteilen, die vollständig automatisch ablaufen:

| Schritt | Aktion | Beschreibung |
|---------|--------|--------------|
| **1. Einfügen** | `Ctrl+V` in den Chatbot | PII Shield fängt das Paste-Event ab, analysiert den Text lokal und ersetzt erkannte PII durch plausible Fake-Daten. Bei Analysefehlern wird das Einfügen blockiert. |
| **2. Verarbeitung** | Chatbot arbeitet | Bei erfolgreicher Analyse erhält der Chatbot den anonymisierten Text. Originalwerte werden nicht in die DOM der Chatbot-Seite geschrieben. |
| **3. Kopieren** | Antwort markieren und kopieren | PII Shield ersetzt bekannte Fake-Daten synchron im Copy-Event durch die lokal gespeicherten Originalwerte. |

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

Die Erkennung kombiniert Gemini Nano mit deterministischen Prüfern für strukturierte PII wie E-Mail, IBAN, Kreditkarten, Telefonnummern, IP-Adressen und Datumswerte. Die KI-Erkennung bleibt probabilistisch; die deterministischen Prüfer decken nur klar strukturierte Kategorien ab.

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

**Paste-Interception:** Das Script fängt das `paste`-Event in der Capture-Phase ab, bevor die Chatbot-Anwendung den Text verarbeitet. Der Text wird an den Service Worker zur PII-Analyse gesendet. Wird PII erkannt, wird der anonymisierte Text eingefügt; wenn die Analyse fehlschlägt, wird nichts eingefügt.

**Copy-Interception:** Beim Kopieren von Text aus der Chatbot-Antwort prüft das Script mit einer lokalen Mapping-Kopie synchron, ob der kopierte Text bekannte Fake-Daten enthält. Falls ja, wird die Zwischenablage während desselben Copy-Events mit den wiederhergestellten Originaldaten beschrieben.

Zusätzlich zeigt das Content Script datensparsame Benachrichtigungen (Banner) an und stellt ein schwebendes Badge-Icon bereit, über das die Extension schnell aktiviert oder deaktiviert werden kann. Der Banner enthält keine Original-PII und keine Mapping-Details.

### 2. Service Worker (`background.js`)

Der Service Worker ist das Herzstück der PII-Erkennung. Er verwaltet eine Gemini Nano Session über die Chrome Prompt API (`LanguageModel.create()`) und nutzt strukturierte Prompt-Ausgaben per JSON Schema (`responseConstraint`), damit PII-Entities validierbar zurückkommen. Zusätzlich laufen deterministische Fallback-Detektoren für strukturierte PII.

Das Mapping wird pro Tab gespeichert (`Map<tabId, Map<fake, original>>`), sodass mehrere Tabs unabhängig voneinander arbeiten können. Die Werte liegen in `chrome.storage.session`, werden bei Tab-Schließung, Navigation, explizitem Löschen und nach Inaktivität bereinigt und nicht in `chrome.storage.local` persistiert.

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

- **Keine Datenübertragung:** Alle PII-Analysen finden lokal im Browser statt. Gemini Nano läuft on-device; die Extension hat keine externen Netzwerk-Endpunkte.
- **Keine externen Server:** Die Extension kommuniziert mit keinem externen Server. Es gibt kein Backend, keine Telemetrie, kein Tracking.
- **Minimale Berechtigungen:** Die Extension benötigt nur `storage` sowie Host-Permissions für die unterstützten Chatbot-Seiten. Clipboard-Zugriffe erfolgen über echte Paste-/Copy-Events.
- **Keine PII in der Host-DOM:** Content-Banner zeigen nur Statusmeldungen und Zähler, keine Originalwerte oder Mapping-Tabellen.
- **Tab-isolierte Mappings:** Jeder Tab hat sein eigenes Mapping. Bei Tab-Schließung, Navigation, Clear-Aktion oder Inaktivität werden die Daten gelöscht.

---

## Einschränkungen

- **Gemini Nano erforderlich:** Die Extension funktioniert nur in Chrome-Versionen, die die Prompt API unterstützen (Chrome 138+). Das Modell muss heruntergeladen sein.
- **KI-basierte Erkennung:** Da ein Teil der PII-Erkennung durch ein Sprachmodell erfolgt, kann es zu False Positives (fälschlich erkannte PII) oder False Negatives (übersehene PII) kommen. Die deterministischen Prüfer verbessern strukturierte Kategorien, ersetzen aber keine vollständige Datenschutzprüfung.
- **Fail-closed:** Wenn Gemini Nano nicht verfügbar ist, das Modell noch lädt, die strukturierte Antwort ungültig ist oder die Analyse timeoutet, wird der Paste-Vorgang blockiert.
- **Textbasiert:** Aktuell werden nur Texteinfügungen über die Zwischenablage überwacht. Datei-Uploads werden nicht analysiert.
- **Latenz:** Die PII-Analyse durch Gemini Nano kann je nach Hardware 1–5 Sekunden dauern. Während dieser Zeit wird das Einfügen blockiert.

---

## Lizenz

MIT License – Frei verwendbar, modifizierbar und verteilbar.
