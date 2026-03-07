// Qaff Studio — i18n Support (English + Arabic)

export type Locale = 'en' | 'ar'

const translations = {
    en: {
        // Videos Manager
        videos: 'Videos',
        videosManager: 'Videos Manager',
        selectVideoForSlot: 'Select Video for Slot',
        browseAndSelect: 'Browse and select a video file for streaming',
        name: 'Name',
        size: 'Size',
        date: 'Date',
        folder: 'Folder',
        actions: 'Actions',
        rename: 'Rename',
        move: 'Move',
        delete: 'Delete',
        copy: 'Copy',
        select: 'Select',
        cancel: 'Cancel',
        confirm: 'Confirm',
        createFolder: 'Create Folder',
        newFolder: 'New Folder',
        folderName: 'Folder Name',
        enterFolderName: 'Enter folder name',
        moveToFolder: 'Move to Folder',
        selectFolder: 'Select target folder',
        rootFolder: 'Root (Main)',
        noVideosFound: 'No videos found',
        uploadVideo: 'Upload Video',
        uploadFolder: 'Upload Folder',
        uploading: 'Uploading...',
        uploadSuccess: 'Upload successful',
        uploadFailed: 'Upload failed',

        // Rename
        renameItem: 'Rename',
        enterNewName: 'Enter new name (without extension)',
        extensionLocked: 'Extension cannot be changed',
        extensionChangeBlocked: 'Extension change is not allowed. The original extension will be kept.',
        renameFailed: 'Failed to rename',
        renameSuccess: 'Renamed successfully',

        // Delete
        deleteConfirm: 'Are you sure you want to delete',
        deleteWarning: 'This action cannot be undone.',
        deleteFailed: 'Failed to delete',
        deleteSuccess: 'Deleted successfully',

        // Move
        moveFailed: 'Failed to move',
        moveSuccess: 'Moved successfully',

        // Download
        downloadFromUrl: 'Download from URL',
        enterUrl: 'Enter video URL (direct link...)',
        fileName: 'File name',
        downloading: 'Downloading...',
        downloadStarted: 'Download started in background',
        downloadComplete: 'Download complete',
        downloadFailed: 'Download failed',

        // Storage
        storage: 'Storage',
        used: 'Used',
        free: 'Free',

        // General
        refresh: 'Refresh',
        close: 'Close',
        back: 'Back',
        root: 'Root',
        items: 'items',
        loading: 'Loading...',
        error: 'Error',
        success: 'Success',
        clear: 'Clear',

        // Header
        diagnostics: 'Diagnostics',
        active: 'Active',
        scheduled: 'Scheduled',
        slots: 'Live Streams Management',
        startAll: 'Start All',
        stopAll: 'Stop All',
        setTimeAll: 'Set Time All',
        dailyAll: 'Daily All',
        resetAll: 'Reset All',
        autoSave: 'Auto-Save',

        colDetails: 'Optional',
        colOutput: 'Output',
        colPlatform: 'Platform',
        colOutputSettings: 'Settings',
        colFilePath: 'File Path',
        colSchedule: 'Schedule',
        colStart: 'Start',
        colAmPm: 'AM/PM',
        colStop: 'Stop',
        colNextRun: 'Next Run',
        colDaily: 'Daily',
        colWeekly: 'Weekly',
        colActions: 'Actions',
        colStatus: 'Status',
        colReset: 'Reset',
        colLogs: 'Logs',
        colFolder: 'Folder',

        // Output dropdown options
        optYouTube: 'YouTube',
        optFacebook: 'Facebook',
        optTikTok: 'TikTok',
        optCustom: 'Custom',

        // Placeholders
        phRtmpServer: 'rtmp://your-rtmp-url',
        phStreamKey: 'Stream Key',
        phFilePath: 'path/to/video.mp4',
        phTikTokServer: 'rtmp://push.tiktokcdn.com/stream',
        phCustomServer: 'rtmp://your-server-url',

        // Output Settings labels
        rtmpBaseLabel: 'RTMP Base (read-only)',
        fullRtmpUrl: 'Full RTMP URL',

        // Copy buttons
        copyPath: 'Copy Path',
        copyKey: 'Copy Key',
        copyRtmp: 'Copy RTMP URL',
        copied: 'Copied!',

        // Footer
        footerText: 'Qaff Digital © - For Sales',
        footerContact: '01202406944',
        footerMoreInfo: 'For more, please visit our website',
        footerLink: 'https://streamer.qaff.net',

        // Theme & Confirms
        theme: 'Theme',
        darkMode: 'Dark Mode',
        lightMode: 'Light Mode',
        demoNoteText: 'Demo Password: test (This interface is for testing only)',
        scheduleAllExt: 'Start Schedule All',
        confirmStartAll: 'Start ALL configured slots?',
        confirmScheduleAll: 'Schedule ALL configured slots based on their set times?',
        confirmStopAll: 'Stop ALL running streams?',
        confirmSetTimeAll: 'Set alternating schedule for ALL empty slots?',
        confirmDailyAll: 'Toggle Daily for ALL slots?',
        confirmResetAll: 'Reset schedule data for ALL slots?',
        logs: 'Logs',

        // Settings & Timezone
        timezoneServer: 'Timezone',
        timezoneWarning: 'It will affect the scheduled times of future streams only, and will have no impact on the currently running streams.',
        timezoneCurrent: 'Current Timezone',
        timezoneNew: 'New Timezone',
        timezoneLoading: 'Loading...',
        timezoneSave: 'Save',

        optional: 'Notes',
        timezoneBtn: 'Timezone',

        // Language
        language: 'Language',
        english: 'English',
        arabic: 'العربية',
        logout: 'Logout',

        // Login
        loginTitle: 'Enter password to continue',
        passwordPlaceholder: 'Password',
        loginButton: 'Login',
        loggingIn: 'Verifying...',
        invalidPassword: 'Invalid password',
        connectionError: 'Connection error — check your network',

        // Video Manager Actions
        recommendedOutput: 'Recommended Output',

        // Validation & Status Messages
        streamKeyRequired: 'Stream key is required.',
        invalidRtmpUrl: 'Invalid RTMP URL. Must start with rtmp:// or rtmps://',
        channelSaved: 'Channel saved successfully.',
        streamFailed: 'Failed to start stream.',
        streamRunning: 'Streaming is running.',
        fileNotFound: 'File not found.',
        outputIncomplete: 'Output configuration is incomplete.',

        // DateTimePicker
        now: 'Now',
        pickDateTime: 'Pick date and time',

        // Logs Panel
        ramUsage: 'RAM',
        dataRate: 'Rate',
        noLogs: 'No logs yet',
        channelLogs: 'Channel Logs',
        liveStats: 'Live Stats',
        renewalPrefix: 'Renewal in',
        renewalDaysSuffix: 'days',
        renewalExpired: 'Subscription Expired',
    },
    ar: {
        // Videos Manager
        videos: 'الفيديوهات',
        videosManager: 'إدارة الفيديوهات',
        selectVideoForSlot: 'اختيار فيديو للقناة',
        browseAndSelect: 'تصفح واختر ملف فيديو للبث',
        name: 'الاسم',
        size: 'الحجم',
        date: 'التاريخ',
        folder: 'المجلد',
        actions: 'الإجراءات',
        rename: 'إعادة تسمية',
        move: 'نقل',
        delete: 'حذف',
        copy: 'نسخ',
        select: 'اختيار',
        cancel: 'إلغاء',
        confirm: 'تأكيد',
        createFolder: 'إنشاء مجلد',
        newFolder: 'مجلد جديد',
        folderName: 'اسم المجلد',
        enterFolderName: 'أدخل اسم المجلد',
        moveToFolder: 'نقل إلى مجلد',
        selectFolder: 'اختر المجلد المستهدف',
        rootFolder: 'الجذر (الرئيسي)',
        noVideosFound: 'لا توجد فيديوهات',
        uploadVideo: 'رفع فيديو',
        uploadFolder: 'رفع مجلد',
        uploading: 'جاري الرفع...',
        uploadSuccess: 'تم الرفع بنجاح',
        uploadFailed: 'فشل الرفع',

        // Rename
        renameItem: 'إعادة التسمية',
        enterNewName: 'أدخل الاسم الجديد (بدون الامتداد)',
        extensionLocked: 'لا يمكن تغيير الامتداد',
        extensionChangeBlocked: 'تغيير الامتداد غير مسموح. سيتم الاحتفاظ بالامتداد الأصلي.',
        renameFailed: 'فشل في إعادة التسمية',
        renameSuccess: 'تمت إعادة التسمية بنجاح',

        // Delete
        deleteConfirm: 'هل أنت متأكد من حذف',
        deleteWarning: 'لا يمكن التراجع عن هذا الإجراء.',
        deleteFailed: 'فشل في الحذف',
        deleteSuccess: 'تم الحذف بنجاح',

        // Move
        moveFailed: 'فشل في النقل',
        moveSuccess: 'تم النقل بنجاح',

        // Download
        downloadFromUrl: 'تحميل من رابط',
        enterUrl: 'أدخل رابط الفيديو (رابط مباشر...)',
        fileName: 'اسم الملف',
        downloading: 'جاري التحميل...',
        downloadStarted: 'بدأ التحميل في الخلفية',
        downloadComplete: 'اكتمل التحميل',
        downloadFailed: 'فشل التحميل',

        // Storage
        storage: 'التخزين',
        used: 'مستخدم',
        free: 'متاح',

        // General
        refresh: 'تحديث',
        close: 'إغلاق',
        back: 'رجوع',
        root: 'الجذر',
        items: 'عناصر',
        loading: 'جاري التحميل...',
        error: 'خطأ',
        success: 'نجاح',
        clear: 'مسح',

        // Header
        diagnostics: 'التشخيص',
        active: 'نشط',
        scheduled: 'مجدول',
        slots: 'إدارة البثوث المباشرة',
        startAll: 'تشغيل الكل',
        stopAll: 'إيقاف الكل',
        setTimeAll: 'ضبط الوقت للكل',
        dailyAll: 'يومي للكل',
        resetAll: 'إعادة تعيين الكل',
        autoSave: 'حفظ تلقائي',

        colDetails: 'ملاحظات',
        colOutput: 'الإخراج',
        colPlatform: 'المنصة',
        colOutputSettings: 'الإعدادات',
        colFilePath: 'مسار الملف',
        colSchedule: 'الجدولة',
        colStart: 'البدء',
        colAmPm: 'ص/م',
        colStop: 'الإيقاف',
        colNextRun: 'التشغيل التالي',
        colDaily: 'يومي',
        colWeekly: 'أسبوعي',
        colActions: 'الإجراءات',
        colStatus: 'الحالة',
        colReset: 'إعادة',
        colLogs: 'السجلات',
        colFolder: 'المجلد',

        // Output dropdown options
        optYouTube: 'يوتيوب',
        optFacebook: 'فيسبوك',
        optTikTok: 'تيك توك',
        optCustom: 'مخصص',

        // Placeholders
        phRtmpServer: 'rtmp://رابط-rtmp-الخاص-بك',
        phStreamKey: 'مفتاح البث',
        phFilePath: 'مسار/الفيديو.mp4',
        phTikTokServer: 'rtmp://push.tiktokcdn.com/stream',
        phCustomServer: 'rtmp://رابط-السيرفر-الخاص-بك',

        // Output Settings labels
        rtmpBaseLabel: 'رابط RTMP الثابت (للقراءة فقط)',
        fullRtmpUrl: 'رابط RTMP الكامل',

        // Copy buttons
        copyPath: 'نسخ المسار',
        copyKey: 'نسخ المفتاح',
        copyRtmp: 'نسخ رابط RTMP',
        copied: 'تم النسخ!',

        // Footer
        footerText: 'قاف ديجيتال © للمبيعات تواصل معنا',
        footerContact: '01202406944',
        footerMoreInfo: 'للمزيد يرجى زيارة موقعنا',
        footerLink: 'https://streamer.qaff.net',

        // Theme & Confirms
        theme: 'المظهر',
        darkMode: 'الوضع الليلي',
        lightMode: 'الوضع الساطع',
        demoNoteText: 'كلمة المرور التجريبية: test (هذه الواجهة للاختبار فقط)',
        scheduleAllExt: 'تشغيل جدولة الكل',
        confirmStartAll: 'هل تريد تشغيل جميع القنوات المجهزة بالبث الآن؟',
        confirmScheduleAll: 'هل تريد جدولة كل القنوات المجهزة بناءً على أوقاتها المحددة؟',
        confirmStopAll: 'هل أنت متأكد من إيقاف جميع عمليات البث الحالية المشغلة؟',
        confirmSetTimeAll: 'هل تريد ضبط أوقات تبادلية لجميع القنوات الفارغة؟',
        confirmDailyAll: 'هل تريد تفعيل/إلغاء التكرار اليومي لجميع القنوات؟',
        confirmResetAll: 'تحذير: هل أنت متأكد من إعادة تعيين ومسح بيانات الجدولة لجميع القنوات؟',
        logs: 'السجلات',

        // Settings & Timezone
        timezoneServer: 'المنطقة الزمنية',
        timezoneWarning: 'سيؤثر على مواعيد جدولة البث المستقبلية ولن يترتب عليه أي تأثير على البثوث المشغّلة حاليًا',
        timezoneCurrent: 'المنطقة الزمنية الحالية',
        timezoneNew: 'المنطقة الزمنية الجديدة',
        timezoneLoading: 'جاري التحميل...',
        timezoneSave: 'حفظ',

        optional: 'ملاحظات',
        timezoneBtn: 'المنطقة الزمنية',

        // Language
        language: 'اللغة',
        english: 'English',
        arabic: 'العربية',
        logout: 'تسجيل الخروج',

        // Login
        loginTitle: 'أدخل كلمة المرور للمتابعة',
        passwordPlaceholder: 'كلمة المرور',
        loginButton: 'دخول',
        loggingIn: 'جارٍ التحقق...',
        invalidPassword: 'كلمة المرور غير صحيحة',
        connectionError: 'حدث خطأ — تحقق من الاتصال',

        // Video Manager Actions
        recommendedOutput: 'الإخراج الموصى به',

        // Validation & Status Messages
        streamKeyRequired: 'مفتاح البث مطلوب.',
        invalidRtmpUrl: 'رابط RTMP غير صالح. يجب أن يبدأ بـ rtmp:// أو rtmps://',
        channelSaved: 'تم حفظ القناة بنجاح.',
        streamFailed: 'تعذّر بدء البث.',
        streamRunning: 'البث يعمل الآن.',
        fileNotFound: 'لم يتم العثور على الملف.',
        outputIncomplete: 'إعدادات الإخراج غير مكتملة.',

        // DateTimePicker
        now: 'الآن',
        pickDateTime: 'اختر التاريخ والوقت',

        // Logs Panel
        ramUsage: 'ذاكرة',
        dataRate: 'معدل',
        noLogs: 'لا توجد سجلات بعد',
        channelLogs: 'سجلات القناة',
        liveStats: 'إحصائيات مباشرة',
        renewalPrefix: 'متبقي',
        renewalDaysSuffix: 'أيام',
        renewalExpired: 'انتهى الاشتراك',
    }
} as const

export type TranslationKey = keyof typeof translations.en

let currentLocale: Locale = 'ar'

export function setLocale(locale: Locale) {
    currentLocale = locale
    if (typeof window !== 'undefined') {
        localStorage.setItem('qaff-locale', locale)
    }
}

export function getLocale(): Locale {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('qaff-locale') as Locale | null
        if (saved && (saved === 'en' || saved === 'ar')) {
            currentLocale = saved
        }
    }
    return currentLocale
}

export function t(key: TranslationKey): string {
    return translations[currentLocale]?.[key] || translations.en[key] || key
}

export function isRTL(): boolean {
    return currentLocale === 'ar'
}
