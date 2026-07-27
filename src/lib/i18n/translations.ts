/**
 * Minimal i18n dictionary — a plain nested record rather than a library,
 * since the app needs lookup and a locale fallback and nothing more (no
 * pluralization rules, no ICU messages, no lazy namespace loading).
 *
 * English is the source of truth: `TranslationKey` is derived from it, so
 * adding a key to `en` makes every other locale's omission a type error at
 * the point where the dictionary is declared.
 */

export const LOCALES = ["en", "es", "de", "ja", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  ja: "日本語",
  hi: "हिन्दी",
};

const en = {
  // --- app chrome ---
  "app.title": "N-Body Orbital Dynamics Lab",
  "app.subtitle": "Advanced simulation lab",
  "app.loading": "Initializing orbital dynamics lab",

  // --- transport ---
  "control.play": "Play",
  "control.pause": "Pause",
  "control.reset": "Reset",
  "control.resetTitle": "Reset to the current preset's initial state",
  "control.preset": "Preset",

  // --- simulation parameters ---
  "section.simulation": "Simulation",
  "param.timestep": "Timestep",
  "param.gravity": "G",
  "param.softening": "Softening",
  "param.stepsPerFrame": "Steps/frame",
  "param.octree": "Use Barnes-Hut octree",
  "param.theta": "Theta (θ)",
  "param.adaptiveTimestep": "Adaptive timestep",
  "param.tidalDisruption": "Tidal disruption",

  // --- visualization ---
  "section.visualization": "Visualization",
  "viz.trails": "Trails",
  "viz.velocityArrows": "Velocity arrows",
  "viz.predictedOrbits": "Show Predicted Orbits",
  "viz.lagrangePoints": "Show Lagrange Points",
  "viz.formulaOverlay": "Formula overlay",
  "viz.spacetimeGrid": "Show Spacetime Grid",
  "viz.hillSpheres": "Show Hill Spheres",
  "viz.rocheLimits": "Show Roche Limits",
  "viz.phaseSpace": "Show Phase Space",
  "viz.resonances": "Show Resonances",
  "viz.gwStrain": "Show GW Strain",
  "viz.lensing": "Lensing (black holes)",
  "viz.radiusScale": "Radius scale",

  // --- sections ---
  "section.computeBackend": "Compute Backend",
  "section.chaos": "Chaos Analysis",
  "section.camera": "Camera",
  "section.missionPlanning": "Mission Planning",
  "section.relativity": "General Relativity",
  "section.accessibility": "Accessibility",

  "backend.cpu": "CPU Worker",
  "backend.gpu": "WebGPU",
  "backend.running": "running",
  "backend.device": "device",
  "backend.noWebgpu": "no WebGPU",

  "chaos.showMap": "Show Chaos Map",
  "chaos.compute": "Compute map",
  "chaos.recompute": "Recompute",
  "chaos.stop": "Stop",
  "chaos.measure": "Measure",
  "chaos.measuring": "measuring…",

  "camera.free": "Free Orbit",
  "camera.follow": "Follow Body",
  "camera.topdown": "Top-Down",
  "camera.flyby": "Flyby",
  "camera.corotating": "Co-rotating",
  "camera.cinematic": "Cinematic",

  "action.planTransfer": "Plan Transfer",
  "action.scenarioScript": "Scenario Script",
  "action.generate": "Generate",
  "action.analytics": "Analytics",
  "action.export": "Export",
  "action.enterVr": "Enter VR",
  "action.addBody": "Add Body",
  "action.save": "Save",
  "action.close": "Close",
  "action.run": "Run",
  "action.clear": "Clear",
  "action.randomize": "Randomize",

  "relativity.enableGR": "Enable GR Precession",
  "relativity.speedOfLight": "Speed of light",

  "a11y.colorBlindMode": "Color-blind palette",
  "a11y.reducedMotion": "Reduced motion active",
  "a11y.highContrast": "High contrast active",
  "a11y.language": "Language",

  // --- inspector ---
  "inspector.empty": "Select a body to inspect it.",
  "inspector.properties": "Properties",
  "inspector.orbitalElements": "Orbital Elements",
  "inspector.mass": "Mass",
  "inspector.radius": "Radius",
  "inspector.removeBody": "Remove body",

  // --- dashboard ---
  "dashboard.fps": "FPS",
  "dashboard.bodies": "Bodies",
  "dashboard.simTime": "Sim time",
  "dashboard.kinetic": "Kinetic",
  "dashboard.potential": "Potential",
  "dashboard.total": "Total",

  // --- announcements (screen reader) ---
  "announce.playing": "Simulation running",
  "announce.paused": "Simulation paused",
  "announce.presetLoaded": "Preset loaded",
  "announce.bodySelected": "Body selected",
  "announce.bodyDeselected": "Selection cleared",

  // --- errors ---
  "error.scriptFailed": "Script error",
  "error.noWebgpu": "WebGPU unavailable in this browser",
  "error.recordingUnsupported": "Recording not supported here",
} as const;

export type TranslationKey = keyof typeof en;

/** Every non-English locale must supply the full key set. */
type Dictionary = Record<TranslationKey, string>;

const es: Dictionary = {
  "app.title": "Laboratorio de Dinámica Orbital de N Cuerpos",
  "app.subtitle": "Laboratorio de simulación avanzada",
  "app.loading": "Inicializando el laboratorio de dinámica orbital",

  "control.play": "Reproducir",
  "control.pause": "Pausar",
  "control.reset": "Reiniciar",
  "control.resetTitle": "Volver al estado inicial del preajuste actual",
  "control.preset": "Preajuste",

  "section.simulation": "Simulación",
  "param.timestep": "Paso de tiempo",
  "param.gravity": "G",
  "param.softening": "Suavizado",
  "param.stepsPerFrame": "Pasos/fotograma",
  "param.octree": "Usar octree Barnes-Hut",
  "param.theta": "Theta (θ)",
  "param.adaptiveTimestep": "Paso de tiempo adaptativo",
  "param.tidalDisruption": "Disrupción de marea",

  "section.visualization": "Visualización",
  "viz.trails": "Estelas",
  "viz.velocityArrows": "Flechas de velocidad",
  "viz.predictedOrbits": "Mostrar órbitas previstas",
  "viz.lagrangePoints": "Mostrar puntos de Lagrange",
  "viz.formulaOverlay": "Superposición de fórmulas",
  "viz.spacetimeGrid": "Mostrar rejilla espaciotemporal",
  "viz.hillSpheres": "Mostrar esferas de Hill",
  "viz.rocheLimits": "Mostrar límites de Roche",
  "viz.phaseSpace": "Mostrar espacio de fases",
  "viz.resonances": "Mostrar resonancias",
  "viz.gwStrain": "Mostrar tensión de ondas gravitacionales",
  "viz.lensing": "Lente gravitacional (agujeros negros)",
  "viz.radiusScale": "Escala de radio",

  "section.computeBackend": "Motor de cálculo",
  "section.chaos": "Análisis de caos",
  "section.camera": "Cámara",
  "section.missionPlanning": "Planificación de misiones",
  "section.relativity": "Relatividad general",
  "section.accessibility": "Accesibilidad",

  "backend.cpu": "Trabajador CPU",
  "backend.gpu": "WebGPU",
  "backend.running": "en ejecución",
  "backend.device": "dispositivo",
  "backend.noWebgpu": "sin WebGPU",

  "chaos.showMap": "Mostrar mapa de caos",
  "chaos.compute": "Calcular mapa",
  "chaos.recompute": "Recalcular",
  "chaos.stop": "Detener",
  "chaos.measure": "Medir",
  "chaos.measuring": "midiendo…",

  "camera.free": "Órbita libre",
  "camera.follow": "Seguir cuerpo",
  "camera.topdown": "Cenital",
  "camera.flyby": "Sobrevuelo",
  "camera.corotating": "Corrotante",
  "camera.cinematic": "Cinemática",

  "action.planTransfer": "Planificar transferencia",
  "action.scenarioScript": "Script de escenario",
  "action.generate": "Generar",
  "action.analytics": "Analíticas",
  "action.export": "Exportar",
  "action.enterVr": "Entrar en RV",
  "action.addBody": "Añadir cuerpo",
  "action.save": "Guardar",
  "action.close": "Cerrar",
  "action.run": "Ejecutar",
  "action.clear": "Limpiar",
  "action.randomize": "Aleatorizar",

  "relativity.enableGR": "Activar precesión relativista",
  "relativity.speedOfLight": "Velocidad de la luz",

  "a11y.colorBlindMode": "Paleta para daltonismo",
  "a11y.reducedMotion": "Movimiento reducido activo",
  "a11y.highContrast": "Alto contraste activo",
  "a11y.language": "Idioma",

  "inspector.empty": "Selecciona un cuerpo para inspeccionarlo.",
  "inspector.properties": "Propiedades",
  "inspector.orbitalElements": "Elementos orbitales",
  "inspector.mass": "Masa",
  "inspector.radius": "Radio",
  "inspector.removeBody": "Eliminar cuerpo",

  "dashboard.fps": "FPS",
  "dashboard.bodies": "Cuerpos",
  "dashboard.simTime": "Tiempo simulado",
  "dashboard.kinetic": "Cinética",
  "dashboard.potential": "Potencial",
  "dashboard.total": "Total",

  "announce.playing": "Simulación en ejecución",
  "announce.paused": "Simulación pausada",
  "announce.presetLoaded": "Preajuste cargado",
  "announce.bodySelected": "Cuerpo seleccionado",
  "announce.bodyDeselected": "Selección borrada",

  "error.scriptFailed": "Error de script",
  "error.noWebgpu": "WebGPU no disponible en este navegador",
  "error.recordingUnsupported": "Grabación no compatible aquí",
};

const de: Dictionary = {
  "app.title": "N-Körper-Bahndynamiklabor",
  "app.subtitle": "Fortgeschrittenes Simulationslabor",
  "app.loading": "Bahndynamiklabor wird initialisiert",

  "control.play": "Start",
  "control.pause": "Pause",
  "control.reset": "Zurücksetzen",
  "control.resetTitle": "Auf den Ausgangszustand der Voreinstellung zurücksetzen",
  "control.preset": "Voreinstellung",

  "section.simulation": "Simulation",
  "param.timestep": "Zeitschritt",
  "param.gravity": "G",
  "param.softening": "Glättung",
  "param.stepsPerFrame": "Schritte/Bild",
  "param.octree": "Barnes-Hut-Octree verwenden",
  "param.theta": "Theta (θ)",
  "param.adaptiveTimestep": "Adaptiver Zeitschritt",
  "param.tidalDisruption": "Gezeitenzerreißung",

  "section.visualization": "Visualisierung",
  "viz.trails": "Bahnspuren",
  "viz.velocityArrows": "Geschwindigkeitspfeile",
  "viz.predictedOrbits": "Vorhergesagte Bahnen anzeigen",
  "viz.lagrangePoints": "Lagrange-Punkte anzeigen",
  "viz.formulaOverlay": "Formelüberlagerung",
  "viz.spacetimeGrid": "Raumzeitgitter anzeigen",
  "viz.hillSpheres": "Hill-Sphären anzeigen",
  "viz.rocheLimits": "Roche-Grenzen anzeigen",
  "viz.phaseSpace": "Phasenraum anzeigen",
  "viz.resonances": "Resonanzen anzeigen",
  "viz.gwStrain": "Gravitationswellen-Dehnung anzeigen",
  "viz.lensing": "Gravitationslinse (Schwarze Löcher)",
  "viz.radiusScale": "Radiusskala",

  "section.computeBackend": "Rechen-Backend",
  "section.chaos": "Chaos-Analyse",
  "section.camera": "Kamera",
  "section.missionPlanning": "Missionsplanung",
  "section.relativity": "Allgemeine Relativitätstheorie",
  "section.accessibility": "Barrierefreiheit",

  "backend.cpu": "CPU-Worker",
  "backend.gpu": "WebGPU",
  "backend.running": "aktiv",
  "backend.device": "Gerät",
  "backend.noWebgpu": "kein WebGPU",

  "chaos.showMap": "Chaoskarte anzeigen",
  "chaos.compute": "Karte berechnen",
  "chaos.recompute": "Neu berechnen",
  "chaos.stop": "Stopp",
  "chaos.measure": "Messen",
  "chaos.measuring": "messe…",

  "camera.free": "Freier Orbit",
  "camera.follow": "Körper folgen",
  "camera.topdown": "Draufsicht",
  "camera.flyby": "Vorbeiflug",
  "camera.corotating": "Mitrotierend",
  "camera.cinematic": "Kinematisch",

  "action.planTransfer": "Transfer planen",
  "action.scenarioScript": "Szenario-Skript",
  "action.generate": "Erzeugen",
  "action.analytics": "Analyse",
  "action.export": "Exportieren",
  "action.enterVr": "VR starten",
  "action.addBody": "Körper hinzufügen",
  "action.save": "Speichern",
  "action.close": "Schließen",
  "action.run": "Ausführen",
  "action.clear": "Leeren",
  "action.randomize": "Zufällig",

  "relativity.enableGR": "ART-Periheldrehung aktivieren",
  "relativity.speedOfLight": "Lichtgeschwindigkeit",

  "a11y.colorBlindMode": "Farbenblindheits-Palette",
  "a11y.reducedMotion": "Reduzierte Bewegung aktiv",
  "a11y.highContrast": "Hoher Kontrast aktiv",
  "a11y.language": "Sprache",

  "inspector.empty": "Wähle einen Körper aus, um ihn zu untersuchen.",
  "inspector.properties": "Eigenschaften",
  "inspector.orbitalElements": "Bahnelemente",
  "inspector.mass": "Masse",
  "inspector.radius": "Radius",
  "inspector.removeBody": "Körper entfernen",

  "dashboard.fps": "FPS",
  "dashboard.bodies": "Körper",
  "dashboard.simTime": "Simulationszeit",
  "dashboard.kinetic": "Kinetisch",
  "dashboard.potential": "Potenziell",
  "dashboard.total": "Gesamt",

  "announce.playing": "Simulation läuft",
  "announce.paused": "Simulation pausiert",
  "announce.presetLoaded": "Voreinstellung geladen",
  "announce.bodySelected": "Körper ausgewählt",
  "announce.bodyDeselected": "Auswahl aufgehoben",

  "error.scriptFailed": "Skriptfehler",
  "error.noWebgpu": "WebGPU in diesem Browser nicht verfügbar",
  "error.recordingUnsupported": "Aufnahme hier nicht unterstützt",
};

const ja: Dictionary = {
  "app.title": "N体軌道力学ラボ",
  "app.subtitle": "高度シミュレーションラボ",
  "app.loading": "軌道力学ラボを初期化しています",

  "control.play": "再生",
  "control.pause": "一時停止",
  "control.reset": "リセット",
  "control.resetTitle": "現在のプリセットの初期状態に戻す",
  "control.preset": "プリセット",

  "section.simulation": "シミュレーション",
  "param.timestep": "時間刻み",
  "param.gravity": "G",
  "param.softening": "ソフトニング",
  "param.stepsPerFrame": "ステップ/フレーム",
  "param.octree": "Barnes-Hut八分木を使用",
  "param.theta": "シータ (θ)",
  "param.adaptiveTimestep": "適応時間刻み",
  "param.tidalDisruption": "潮汐破壊",

  "section.visualization": "可視化",
  "viz.trails": "軌跡",
  "viz.velocityArrows": "速度ベクトル",
  "viz.predictedOrbits": "予測軌道を表示",
  "viz.lagrangePoints": "ラグランジュ点を表示",
  "viz.formulaOverlay": "数式オーバーレイ",
  "viz.spacetimeGrid": "時空格子を表示",
  "viz.hillSpheres": "ヒル球を表示",
  "viz.rocheLimits": "ロッシュ限界を表示",
  "viz.phaseSpace": "位相空間を表示",
  "viz.resonances": "共鳴を表示",
  "viz.gwStrain": "重力波ひずみを表示",
  "viz.lensing": "重力レンズ（ブラックホール）",
  "viz.radiusScale": "半径スケール",

  "section.computeBackend": "計算バックエンド",
  "section.chaos": "カオス解析",
  "section.camera": "カメラ",
  "section.missionPlanning": "ミッション計画",
  "section.relativity": "一般相対性理論",
  "section.accessibility": "アクセシビリティ",

  "backend.cpu": "CPUワーカー",
  "backend.gpu": "WebGPU",
  "backend.running": "実行中",
  "backend.device": "デバイス",
  "backend.noWebgpu": "WebGPUなし",

  "chaos.showMap": "カオスマップを表示",
  "chaos.compute": "マップを計算",
  "chaos.recompute": "再計算",
  "chaos.stop": "停止",
  "chaos.measure": "測定",
  "chaos.measuring": "測定中…",

  "camera.free": "フリー軌道",
  "camera.follow": "天体を追従",
  "camera.topdown": "真上から",
  "camera.flyby": "フライバイ",
  "camera.corotating": "共回転系",
  "camera.cinematic": "シネマティック",

  "action.planTransfer": "遷移軌道を計画",
  "action.scenarioScript": "シナリオスクリプト",
  "action.generate": "生成",
  "action.analytics": "解析",
  "action.export": "エクスポート",
  "action.enterVr": "VRを開始",
  "action.addBody": "天体を追加",
  "action.save": "保存",
  "action.close": "閉じる",
  "action.run": "実行",
  "action.clear": "クリア",
  "action.randomize": "ランダム化",

  "relativity.enableGR": "相対論的近日点移動を有効化",
  "relativity.speedOfLight": "光速",

  "a11y.colorBlindMode": "色覚多様性パレット",
  "a11y.reducedMotion": "モーション低減が有効",
  "a11y.highContrast": "ハイコントラストが有効",
  "a11y.language": "言語",

  "inspector.empty": "天体を選択すると詳細が表示されます。",
  "inspector.properties": "プロパティ",
  "inspector.orbitalElements": "軌道要素",
  "inspector.mass": "質量",
  "inspector.radius": "半径",
  "inspector.removeBody": "天体を削除",

  "dashboard.fps": "FPS",
  "dashboard.bodies": "天体数",
  "dashboard.simTime": "シミュレーション時間",
  "dashboard.kinetic": "運動エネルギー",
  "dashboard.potential": "位置エネルギー",
  "dashboard.total": "合計",

  "announce.playing": "シミュレーション実行中",
  "announce.paused": "シミュレーション一時停止",
  "announce.presetLoaded": "プリセットを読み込みました",
  "announce.bodySelected": "天体を選択しました",
  "announce.bodyDeselected": "選択を解除しました",

  "error.scriptFailed": "スクリプトエラー",
  "error.noWebgpu": "このブラウザーではWebGPUを利用できません",
  "error.recordingUnsupported": "ここでは録画に対応していません",
};

const hi: Dictionary = {
  "app.title": "एन-बॉडी कक्षीय गतिकी प्रयोगशाला",
  "app.subtitle": "उन्नत सिमुलेशन प्रयोगशाला",
  "app.loading": "कक्षीय गतिकी प्रयोगशाला आरंभ हो रही है",

  "control.play": "चलाएँ",
  "control.pause": "रोकें",
  "control.reset": "रीसेट",
  "control.resetTitle": "वर्तमान प्रीसेट की प्रारंभिक स्थिति पर लौटें",
  "control.preset": "प्रीसेट",

  "section.simulation": "सिमुलेशन",
  "param.timestep": "समय-चरण",
  "param.gravity": "G",
  "param.softening": "सॉफ़्टनिंग",
  "param.stepsPerFrame": "चरण/फ़्रेम",
  "param.octree": "बार्न्स-हट ऑक्ट्री उपयोग करें",
  "param.theta": "थीटा (θ)",
  "param.adaptiveTimestep": "अनुकूली समय-चरण",
  "param.tidalDisruption": "ज्वारीय विघटन",

  "section.visualization": "दृश्यीकरण",
  "viz.trails": "पथ-रेखाएँ",
  "viz.velocityArrows": "वेग तीर",
  "viz.predictedOrbits": "अनुमानित कक्षाएँ दिखाएँ",
  "viz.lagrangePoints": "लाग्रांज बिंदु दिखाएँ",
  "viz.formulaOverlay": "सूत्र ओवरले",
  "viz.spacetimeGrid": "दिक्काल ग्रिड दिखाएँ",
  "viz.hillSpheres": "हिल गोले दिखाएँ",
  "viz.rocheLimits": "रोश सीमाएँ दिखाएँ",
  "viz.phaseSpace": "प्रावस्था समष्टि दिखाएँ",
  "viz.resonances": "अनुनाद दिखाएँ",
  "viz.gwStrain": "गुरुत्वीय तरंग विकृति दिखाएँ",
  "viz.lensing": "गुरुत्वीय लेंसिंग (कृष्ण विवर)",
  "viz.radiusScale": "त्रिज्या मापक",

  "section.computeBackend": "गणना बैकएंड",
  "section.chaos": "अराजकता विश्लेषण",
  "section.camera": "कैमरा",
  "section.missionPlanning": "मिशन नियोजन",
  "section.relativity": "सामान्य आपेक्षिकता",
  "section.accessibility": "सुगम्यता",

  "backend.cpu": "CPU वर्कर",
  "backend.gpu": "WebGPU",
  "backend.running": "चल रहा है",
  "backend.device": "उपकरण",
  "backend.noWebgpu": "WebGPU नहीं",

  "chaos.showMap": "अराजकता मानचित्र दिखाएँ",
  "chaos.compute": "मानचित्र गणना करें",
  "chaos.recompute": "पुनः गणना करें",
  "chaos.stop": "रोकें",
  "chaos.measure": "मापें",
  "chaos.measuring": "माप रहा है…",

  "camera.free": "मुक्त कक्षा",
  "camera.follow": "पिंड का अनुसरण",
  "camera.topdown": "ऊपर से दृश्य",
  "camera.flyby": "फ्लाईबाई",
  "camera.corotating": "सह-घूर्णी",
  "camera.cinematic": "सिनेमाई",

  "action.planTransfer": "स्थानांतरण योजना",
  "action.scenarioScript": "परिदृश्य स्क्रिप्ट",
  "action.generate": "उत्पन्न करें",
  "action.analytics": "विश्लेषण",
  "action.export": "निर्यात",
  "action.enterVr": "VR में प्रवेश",
  "action.addBody": "पिंड जोड़ें",
  "action.save": "सहेजें",
  "action.close": "बंद करें",
  "action.run": "चलाएँ",
  "action.clear": "साफ़ करें",
  "action.randomize": "यादृच्छिक",

  "relativity.enableGR": "आपेक्षिक अयन-गति सक्षम करें",
  "relativity.speedOfLight": "प्रकाश की गति",

  "a11y.colorBlindMode": "वर्णांधता पैलेट",
  "a11y.reducedMotion": "कम गति सक्रिय",
  "a11y.highContrast": "उच्च कंट्रास्ट सक्रिय",
  "a11y.language": "भाषा",

  "inspector.empty": "निरीक्षण हेतु कोई पिंड चुनें।",
  "inspector.properties": "गुण",
  "inspector.orbitalElements": "कक्षीय तत्व",
  "inspector.mass": "द्रव्यमान",
  "inspector.radius": "त्रिज्या",
  "inspector.removeBody": "पिंड हटाएँ",

  "dashboard.fps": "FPS",
  "dashboard.bodies": "पिंड",
  "dashboard.simTime": "सिमुलेशन समय",
  "dashboard.kinetic": "गतिज",
  "dashboard.potential": "स्थितिज",
  "dashboard.total": "कुल",

  "announce.playing": "सिमुलेशन चल रहा है",
  "announce.paused": "सिमुलेशन रुका",
  "announce.presetLoaded": "प्रीसेट लोड हुआ",
  "announce.bodySelected": "पिंड चयनित",
  "announce.bodyDeselected": "चयन हटाया गया",

  "error.scriptFailed": "स्क्रिप्ट त्रुटि",
  "error.noWebgpu": "इस ब्राउज़र में WebGPU उपलब्ध नहीं",
  "error.recordingUnsupported": "यहाँ रिकॉर्डिंग समर्थित नहीं",
};

export const TRANSLATIONS: Record<Locale, Dictionary> = { en, es, de, ja, hi };
