import { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

let socket;

export default function Home() {
  const [form, setForm] = useState({
    konum: "İstanbul",
    anahtarKelime: "Yazılım",
    maksSonuc: 100,
    websiteTimeout: 15,
    ePostaAramasiYapilsin: true,
  });

  const [isScraping, setIsScraping] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [sirketler, setSirketler] = useState([]);
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  const timerRef = useRef(null);
  const logAreaRef = useRef(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

 useEffect(() => {
    const socketInitializer = async () => {
      await fetch("/api/socket");

      socket = io(undefined, {
        path: "/api/socket_io", 
      });
      socket.on("connect", () => {
        addLog("✅ Sistem v2.4.1-stable bağlantısı kuruldu.", "SUCCESS");
      });

      socket.on("log", (msg) => {
        let type = "INFO";
        const msgStr = typeof msg === 'string' ? msg : JSON.stringify(msg);

        if (msgStr.toLowerCase().includes("hata") || msgStr.toLowerCase().includes("error")) type = "ERROR";
        else if (msgStr.toLowerCase().includes("bulundu") || msgStr.toLowerCase().includes("success") || msgStr.toLowerCase().includes("bitti")) type = "SUCCESS";
        else if (msgStr.toLowerCase().includes("uyarı") || msgStr.toLowerCase().includes("warn") || msgStr.toLowerCase().includes("durdur")) type = "WARN";

        addLog(msgStr, type);
      });

      socket.on("progress", (val) => setProgress(val));

      socket.on("yeni_sirket", (sirket) => {
        const sirketWithId = {
          ...sirket,
          id: sirket.id || Math.random().toString(36).substr(2, 9)
        };
        setSirketler((prev) => [...prev, sirketWithId]);
      });

      socket.on("finished", () => {
        setIsScraping(false);
        setProgress(100);
        stopTimer();
        addLog("Analiz işlemi başarıyla tamamlandı.", "SUCCESS");
      });
    };

    socketInitializer();

    return () => {
      if (socket) socket.disconnect();
      stopTimer();
    };
  }, []);

  useEffect(() => {
    if (logAreaRef.current) {
      logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (text, type = "INFO") => {
    const time = new Date().toLocaleTimeString("tr-TR", { hour12: false });
    setLogs((prev) => [...prev, { time, text, type }]);
  };

  const startTimer = () => {
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const diff = now - startTime;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setElapsedTime(
        `${hours.toString().padStart(2, "0")}:${minutes
          .toString()
          .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
      );
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleStartScraping = async () => {
    setSirketler([]);
    setSelectedRowIds([]);
    setLogs([]);
    addLog("Analiz parametreleri işleniyor...", "WARN");
    setProgress(0);
    setIsScraping(true);
    setElapsedTime("00:00:00");
    startTimer();

    try {
      await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } catch (error) {
      addLog(`API Bağlantı Hatası: ${error.message}`, "ERROR");
      setIsScraping(false);
      stopTimer();
    }
  };

  const handleStopScraping = async () => {
    await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    setIsScraping(false);
    stopTimer();
    addLog("İşlem kullanıcı tarafından iptal edildi.", "WARN");
  };

  const handleExportExcel = (onlySelected = false) => {
    const dataToExport = onlySelected
      ? sirketler.filter((s) => selectedRowIds.includes(s.id))
      : sirketler;

    if (dataToExport.length === 0) {
      alert("Dışa aktarılacak veri bulunamadı.");
      return;
    }

    const formattedData = dataToExport.map((item) => ({
      "İşletme Adı": item.IsletmeAdi,
      "Uzmanlık Alanı": item.Uzmanliklar || "Belirtilmemiş",
      "Telefon": item.Telefon,
      "E-Posta": item.Eposta === "Bulunamadı" ? "" : item.Eposta,
      "Web Sitesi": item.WebSitesi === "Bulunamadı" ? "" : item.WebSitesi,
      "LinkedIn": item.LinkedIn === "Bulunamadı" ? "" : item.LinkedIn,
      "Google Puanı": item.Puan,
      "Yorum Sayısı": item.YorumSayisi || "0",
      "Adres": item.Adres,
      "Açıklama": item.Aciklama || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const wscols = [
      { wch: 35 }, 
      { wch: 25 }, 
      { wch: 15 }, 
      { wch: 25 }, 
      { wch: 30 }, 
      { wch: 30 },
      { wch: 10 }, 
      { wch: 10 },
      { wch: 50 },
      { wch: 50 },
    ];
    worksheet['!cols'] = wscols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Firmalar");
    
    const fileName = `Firmalytics_Pro_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const data = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    
    saveAs(data, fileName);
    addLog(`${dataToExport.length} adet kayıt Excel formatında dışa aktarıldı.`, "SUCCESS");
  };

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      const currentIds = currentTableData.map(r => r.id);
      setSelectedRowIds(prev => [...new Set([...prev, ...currentIds])]);
    } else {
      const currentIds = currentTableData.map(r => r.id);
      setSelectedRowIds(prev => prev.filter(id => !currentIds.includes(id)));
    }
  };

  const toggleSelectRow = (id) => {
    setSelectedRowIds((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    );
  };

  const indexOfLastRow = currentPage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const currentTableData = sirketler.slice(indexOfFirstRow, indexOfLastRow);
  const totalPages = Math.ceil(sirketler.length / rowsPerPage);

  return (
    <div className="flex h-screen w-screen bg-background-light dark:bg-background-dark text-slate-200 overflow-hidden font-display">
      
      {/* SIDEBAR */}
      <aside className="w-80 h-full flex flex-col border-r border-white/5 bg-surface-dark/50 relative z-20 shadow-2xl shrink-0">
        <div className="p-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-lg border border-primary/30">
              <span className="material-symbols-outlined text-primary" style={{fontSize: "28px"}}>hub</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-white text-xl font-bold tracking-tight leading-none">Firmalytics</h1>
              <span className="text-primary text-[10px] font-bold tracking-widest mt-1">PRO DASHBOARD</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <div>
            <h3 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[16px]">tune</span>
              Arama Parametreleri
            </h3>
            <div className="space-y-4">
              <label className="block group">
                <span className="text-sm font-medium text-white/80 mb-1.5 block group-focus-within:text-primary transition-colors">
                  Konum / Şehir
                </span>
                <div className="relative">
                  <input
                    name="konum"
                    value={form.konum}
                    onChange={handleInputChange}
                    disabled={isScraping}
                    className="w-full bg-surface-darker border border-white/10 rounded-lg h-12 px-4 pl-11 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-white/20 outline-none"
                    placeholder="Örn: İstanbul, Maslak"
                  />
                  <span className="material-symbols-outlined absolute left-3 top-3 text-white/40 group-focus-within:text-primary transition-colors">
                    location_on
                  </span>
                </div>
              </label>
              <label className="block group">
                <span className="text-sm font-medium text-white/80 mb-1.5 block group-focus-within:text-primary transition-colors">
                  Sektör / Kelime
                </span>
                <div className="relative">
                  <input
                    name="anahtarKelime"
                    value={form.anahtarKelime}
                    onChange={handleInputChange}
                    disabled={isScraping}
                    className="w-full bg-surface-darker border border-white/10 rounded-lg h-12 px-4 pl-11 text-sm text-white focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-white/20 outline-none"
                    placeholder="Örn: Yazılım, Tekstil"
                  />
                  <span className="material-symbols-outlined absolute left-3 top-3 text-white/40 group-focus-within:text-primary transition-colors">
                    business_center
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="bg-surface-darker/50 p-4 rounded-xl border border-white/5">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-medium text-white/90">Max Sonuç</span>
              <span className="text-primary font-bold text-sm bg-primary/10 px-2 py-0.5 rounded">
                {form.maksSonuc}
              </span>
            </div>
            
            <div className="relative w-full h-6 flex items-center">
                <input 
                    type="range" 
                    min="10" 
                    max="500" 
                    step="10"
                    name="maksSonuc"
                    value={form.maksSonuc}
                    onChange={handleInputChange}
                    disabled={isScraping}
                    className="w-full absolute z-20 opacity-0 cursor-pointer h-full"
                />
                <div className="relative h-2 bg-surface-dark rounded-full w-full">
                    <div 
                        className="absolute h-full bg-primary rounded-full shadow-[0_0_10px_rgba(0,209,209,0.5)] transition-all duration-150" 
                        style={{ width: `${(form.maksSonuc / 500) * 100}%` }}
                    ></div>
                    <div 
                        className="absolute h-4 w-4 bg-white rounded-full border-2 border-primary -top-1 shadow-lg transform -translate-x-1/2 transition-all duration-150 pointer-events-none"
                        style={{ left: `${(form.maksSonuc / 500) * 100}%` }}
                    ></div>
                </div>
            </div>

            <div className="flex justify-between text-[10px] text-white/30 font-mono mt-2">
              <span>10</span>
              <span>500</span>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-2">Veri Detayları</h4>
            <label className="flex items-center justify-between p-3 rounded-lg bg-surface-darker border border-white/5 cursor-pointer hover:border-white/10 transition-colors">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-white/50">mail</span>
                <span className="text-sm text-white/90">Web Sitesi Tara (E-posta/Linkedİn)</span>
              </div>
              <div className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="ePostaAramasiYapilsin"
                  checked={form.ePostaAramasiYapilsin}
                  onChange={handleInputChange}
                  disabled={isScraping}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </div>
            </label>
            <div className="text-[10px] text-white/30 px-1">
                * LinkedIn taraması web sitesi analizi seçildiğinde otomatik yapılır.
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/5 bg-surface-darker/50 space-y-3">
          {!isScraping ? (
            <button
              onClick={handleStartScraping}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-surface-darker font-bold py-3 px-4 rounded-lg transition-all shadow-[0_0_20px_rgba(0,209,209,0.2)] hover:shadow-[0_0_25px_rgba(0,209,209,0.4)] cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px] font-bold">play_arrow</span>
              <span>Analizi Başlat</span>
            </button>
          ) : (
            <button
              onClick={handleStopScraping}
              className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 font-medium py-2 px-4 rounded-lg transition-all border border-white/5 active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">stop</span>
              <span>Durdur</span>
            </button>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col relative h-full">
        {/* */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] grid-bg"></div>

        {/* TOP HEADER */}
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-surface-dark/30 shrink-0 backdrop-blur-sm z-10">
          <div className="flex items-center gap-8">
            <div className="flex flex-col">
              <span className="text-xs text-white/40 uppercase tracking-widest font-semibold">Bulunan Firma</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white font-mono">{sirketler.length}</span>
                {isScraping && (
                    <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono animate-pulse">
                        +{Math.floor(Math.random() * 3)}/sn
                    </span>
                )}
              </div>
            </div>
            <div className="h-8 w-px bg-white/10"></div>
            <div className="flex flex-col">
              <span className="text-xs text-white/40 uppercase tracking-widest font-semibold">Geçen Süre</span>
              <span className="text-xl font-medium text-white/80 font-mono">{elapsedTime}</span>
            </div>
            <div className="h-8 w-px bg-white/10"></div>
            <div className="flex flex-col">
              <span className="text-xs text-white/40 uppercase tracking-widest font-semibold">İşlem Durumu</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isScraping ? 'bg-emerald-400' : 'bg-gray-500'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isScraping ? 'bg-emerald-500' : 'bg-gray-500'}`}></span>
                </span>
                <span className={`text-sm font-medium ${isScraping ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {isScraping ? "Veri Çekiliyor" : "Hazır Bekliyor"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="w-64">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-white/50">İlerleme</span>
              <span className="text-primary">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 bg-surface-darker rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full relative overflow-hidden transition-all duration-300" 
                style={{ width: `${Math.max(2, progress)}%` }}
              >
                {isScraping && <div className="absolute inset-0 bg-white/20 w-full animate-shimmer -skew-x-12 translate-x-[-100%]"></div>}
              </div>
            </div>
          </div>
        </header>

        {/* SUB HEADER (Actions) */}
        <div className="h-16 border-b border-white/5 bg-surface-darker/60 flex items-center justify-between px-8 shrink-0 z-10 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            {selectedRowIds.length > 0 && (
              <div className="flex items-center gap-3 px-3 py-1.5 bg-primary/10 rounded border border-primary/20 animate-in fade-in zoom-in-95 duration-200">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-surface-darker text-[10px] font-bold">
                    {selectedRowIds.length}
                </span>
                <span className="text-xs font-bold text-primary">satır seçildi</span>
                <button onClick={() => setSelectedRowIds([])} className="ml-1 text-primary/60 hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button 
                onClick={() => handleExportExcel(false)}
                className="group flex items-center gap-2 px-4 py-2 rounded bg-surface-dark border border-white/10 text-white/70 hover:text-white hover:bg-white/5 hover:border-white/20 transition-all text-xs font-bold uppercase tracking-wide cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] group-hover:text-green-400 transition-colors">table_view</span>
              <span>Tümünü Excel Aktar</span>
            </button>
            <div className="h-6 w-px bg-white/10"></div>
            <button 
                onClick={() => handleExportExcel(true)}
                disabled={selectedRowIds.length === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded transition-all text-xs font-bold uppercase tracking-wide cursor-pointer
                ${selectedRowIds.length > 0 
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:brightness-110 hover:-translate-y-0.5' 
                    : 'bg-white/5 text-white/30 cursor-not-allowed'}`}
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>Seçilenleri Excel Aktar</span>
            </button>
          </div>
        </div>

        {/* DATA TABLE */}
        <div className="flex-1 overflow-auto bg-background-dark relative">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-darker sticky top-0 z-10 shadow-lg">
              <tr>
                <th className="p-4 pl-8 w-[20px] border-b border-white/5 bg-surface-darker">
                  <div className="flex items-center h-full">
                    <input 
                        type="checkbox" 
                        onChange={toggleSelectAll}
                        checked={currentTableData.length > 0 && currentTableData.every(r => selectedRowIds.includes(r.id))}
                        className="rounded bg-surface-dark border-white/20 text-primary focus:ring-1 focus:ring-primary focus:ring-offset-0 focus:ring-offset-transparent h-4 w-4 cursor-pointer transition-colors checked:bg-primary checked:border-primary" 
                    />
                  </div>
                </th>
                <th className="p-4 pl-4 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/5 font-mono w-[60px]">#</th>
                <th className="p-4 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/5 w-[25%]">Firma Adı</th>
                <th className="p-4 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/5 w-[15%]">Uzmanlık</th>
                <th className="p-4 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/5 w-[30%]">Açıklama</th>
                <th className="p-4 text-xs font-semibold text-white/40 uppercase tracking-wider border-b border-white/5 text-right pr-8">Puan & İletişim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
                {currentTableData.length === 0 ? (
                    <tr>
                        <td colSpan="6" className="p-12 text-center text-white/30 bg-[#0a1515]">
                            {isScraping ? (
                                <div className="flex flex-col items-center gap-4">
                                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                                    <span className="animate-pulse">Veriler taranıyor...</span>
                                </div>
                            ) : (
                                "Veri bulunamadı. Analizi başlatın."
                            )}
                        </td>
                    </tr>
                ) : (
                    currentTableData.map((row, index) => {
                        const isSelected = selectedRowIds.includes(row.id);
                        const rowNumber = (currentPage - 1) * rowsPerPage + index + 1;
                        const initial = row.IsletmeAdi ? row.IsletmeAdi.charAt(0) : "?";
    
                        const colors = [
                            "from-blue-500/20 to-purple-500/20", 
                            "from-emerald-500/20 to-teal-500/20", 
                            "from-cyan-500/20 to-blue-500/20",
                            "from-pink-500/20 to-rose-500/20",
                            "from-primary/20 to-cyan-500/20"
                        ];
                        const colorClass = colors[rowNumber % colors.length];

                        return (
                            <tr key={row.id} className={`group transition-colors cursor-default hover:bg-[#0e1c1c] ${isSelected ? 'bg-[#0e1c1c]' : 'bg-[#0a1515]'}`}>
                                <td className={`p-4 pl-8 border-l-2 align-middle ${isSelected ? 'border-primary' : 'border-transparent'}`}>
                                    <div className="flex items-center justify-center h-full">
                                        <input 
                                            type="checkbox" 
                                            checked={isSelected}
                                            onChange={() => toggleSelectRow(row.id)}
                                            className="rounded bg-surface-dark border-white/20 text-primary focus:ring-1 focus:ring-primary focus:ring-offset-0 focus:ring-offset-transparent h-4 w-4 cursor-pointer transition-colors checked:bg-primary checked:border-primary" 
                                        />
                                    </div>
                                </td>
                                <td className="p-4 pl-4 text-white/30 font-mono text-xs align-middle">
                                    {rowNumber.toString().padStart(3, '0')}
                                </td>
                                <td className="p-4 align-top">
                                    <div className="flex gap-3">
                                        <div className={`size-8 rounded bg-gradient-to-br ${colorClass} flex items-center justify-center border border-white/5 shrink-0 mt-0.5`}>
                                            <span className="text-xs font-bold text-white">{initial}</span>
                                        </div>
                                        <div className="font-bold text-white group-hover:text-primary transition-colors text-base leading-snug line-clamp-2">
                                            {row.IsletmeAdi}
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 align-middle">
                                    {row.Uzmanliklar ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 whitespace-nowrap max-w-[140px] truncate">
                                            {row.Uzmanliklar.split(',')[0]}
                                        </span>
                                    ) : <span className="text-white/20 text-xs">-</span>}
                                </td>
                                <td className="p-4 align-middle">
                                    <div className="text-white/60 line-clamp-2 group-hover:text-white/80 transition-colors text-xs">
                                        {row.Aciklama || <span className="italic text-white/20">Açıklama yok</span>}
                                    </div>
                                </td>
                                <td className="p-4 text-right pr-8 align-middle">
                                    <div className="flex items-center justify-end gap-3 text-white/40">
                                        {/* Puan Badge */}
                                        {row.Puan && (
                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 mr-2">
                                                <span className="material-symbols-outlined text-[14px]">star</span>
                                                <span className="text-xs font-bold font-mono">{row.Puan}</span>
                                            </div>
                                        )}

                                        {/* Web */}
                                        {row.WebSitesi && row.WebSitesi !== "Bulunamadı" ? (
                                            <a href={row.WebSitesi} target="_blank" className="hover:text-white hover:bg-white/10 p-1.5 rounded transition-all">
                                                <span className="material-symbols-outlined text-[18px]">language</span>
                                            </a>
                                        ) : <span className="p-1.5 opacity-20 cursor-not-allowed"><span className="material-symbols-outlined text-[18px]">language</span></span>}
                                        
                                        {/* Mail */}
                                        {row.Eposta && row.Eposta !== "Bulunamadı" && row.Eposta !== "-" ? (
                                            <a href={`mailto:${row.Eposta}`} className="hover:text-primary hover:bg-primary/10 p-1.5 rounded transition-all">
                                                <span className="material-symbols-outlined text-[18px]">mail</span>
                                            </a>
                                        ) : <span className="p-1.5 opacity-20 cursor-not-allowed"><span className="material-symbols-outlined text-[18px]">mail</span></span>}

                                        {/* LinkedIn */}
                                        {row.LinkedIn && row.LinkedIn !== "Bulunamadı" && row.LinkedIn !== "" ? (
                                            <a href={row.LinkedIn} target="_blank" className="hover:text-blue-400 hover:bg-blue-400/10 p-1.5 rounded transition-all">
                                                <span className="material-symbols-outlined text-[18px]">link</span>
                                            </a>
                                        ) : <span className="p-1.5 opacity-20 cursor-not-allowed"><span className="material-symbols-outlined text-[18px]">link_off</span></span>}
                                        
                                        {/* Tel */}
                                         {row.Telefon ? (
                                            <div title={row.Telefon} className="cursor-help hover:text-emerald-400 hover:bg-emerald-400/10 p-1.5 rounded transition-all">
                                                <span className="material-symbols-outlined text-[18px]">phone</span>
                                            </div>
                                        ) : <span className="p-1.5 opacity-20 cursor-not-allowed"><span className="material-symbols-outlined text-[18px]">phone_disabled</span></span>}
                                    </div>
                                </td>
                            </tr>
                        );
                    })
                )}
            </tbody>
          </table>
        </div>

        {/* FOOTER PAGINATION */}
        <div className="border-t border-white/5 bg-surface-dark px-6 py-3 flex items-center justify-between shrink-0 z-20 shadow-[0_-5px_20px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-6">
                <span className="text-xs text-white/40 font-mono hidden sm:inline-block">
                    Gösteriliyor <span className="text-white font-semibold">{sirketler.length > 0 ? indexOfFirstRow + 1 : 0}-{Math.min(indexOfLastRow, sirketler.length)}</span> / <span className="text-white font-semibold">{sirketler.length}</span>
                </span>
                <div className="h-4 w-px bg-white/10 hidden sm:block"></div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-white/40">Sayfa Başına:</span>
                    <div className="relative group">
                        <select 
                            value={rowsPerPage}
                            onChange={(e) => {
                                setRowsPerPage(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="appearance-none bg-surface-darker border border-white/10 rounded hover:border-white/20 transition-colors pl-3 pr-8 py-1 text-xs text-white font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 cursor-pointer"
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                        <span className="material-symbols-outlined absolute right-1 top-1/2 -translate-y-1/2 text-[16px] text-white/40 pointer-events-none group-hover:text-white/60 transition-colors">arrow_drop_down</span>
                    </div>
                </div>
            </div>
            
            <nav className="flex items-center gap-2">
                <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="h-8 px-3 rounded border border-white/10 bg-surface-darker text-white/60 hover:text-white hover:bg-white/5 hover:border-white/20 transition-all text-xs font-medium flex items-center gap-1 group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <span className="material-symbols-outlined text-[16px] group-hover:-translate-x-0.5 transition-transform">chevron_left</span>
                    Önceki
                </button>
                <div className="flex items-center gap-1">
                    <span className="h-8 min-w-[32px] px-2 flex items-center justify-center rounded border border-primary/30 bg-primary/10 text-primary text-xs font-bold shadow-[0_0_15px_rgba(0,209,209,0.15)]">
                        {currentPage}
                    </span>
                    <span className="text-white/30 text-xs">/</span>
                    <span className="h-8 min-w-[32px] flex items-center justify-center text-white/50 text-xs font-medium">
                        {totalPages || 1}
                    </span>
                </div>
                <button 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="h-8 px-3 rounded border border-white/10 bg-surface-darker text-white/60 hover:text-white hover:bg-white/5 hover:border-white/20 transition-all text-xs font-medium flex items-center gap-1 group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Sonraki
                    <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">chevron_right</span>
                </button>
            </nav>
        </div>

        {/* LOG PANEL */}
        <div className="h-64 bg-black border-t border-white/10 flex flex-col shrink-0 font-mono text-xs">
          <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-white/50 text-[14px]">terminal</span>
              <span className="text-white/70 font-semibold uppercase tracking-wider">Live Action Log</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setLogs([])} className="text-white/40 hover:text-white transition-colors" title="Temizle">
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
              <button className="text-white/40 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-[16px]">expand_less</span>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-1 relative scanline-overlay" ref={logAreaRef}>
            {logs.length === 0 && <div className="text-white/20 italic pl-2 border-l-2 border-transparent">[Sistem Beklemede] Hazır...</div>}
            
            {logs.map((log, i) => (
                <div key={i} className={`border-l-2 pl-2 py-0.5 font-mono ${
                    log.type === 'SUCCESS' ? 'border-emerald-500/50 bg-emerald-500/5 text-white/90' :
                    log.type === 'ERROR' ? 'border-red-500/50 bg-red-500/5 text-red-200' :
                    log.type === 'WARN' ? 'border-yellow-500/50 text-yellow-100' :
                    'border-transparent text-white/50'
                }`}>
                    <span className="opacity-50 mr-2">[{log.time}]</span>
                    <span className={`font-bold mr-2 ${
                        log.type === 'SUCCESS' ? 'text-emerald-400' :
                        log.type === 'ERROR' ? 'text-red-400' :
                        log.type === 'WARN' ? 'text-yellow-400' :
                        'text-blue-400'
                    }`}>{log.type}</span>
                    {log.text}
                </div>
            ))}
            
            {isScraping && (
                <div className="flex items-center gap-1 pl-2 mt-2">
                    <span className="text-primary">&gt;</span>
                    <span className="w-2 h-4 bg-primary animate-pulse"></span>
                </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}