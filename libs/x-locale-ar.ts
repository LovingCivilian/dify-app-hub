import type enUS from '@ant-design/x/locale/en_US'

// The X docs name no import path for the locale type, so it is derived from the documented English pack (every string required).
type XLocale = typeof enUS

/** Ant Design X ships only en_US and zh_CN; this is the fork's Arabic pack (ADR-0005 wording rules). */
const arEG_X: XLocale = {
	locale: 'ar',
	Conversations: { create: 'محادثة جديدة' },
	Sender: { stopLoading: 'إيقاف التحميل', speechRecording: 'تسجيل صوتي' },
	Actions: {
		feedbackLike: 'إعجاب',
		feedbackDislike: 'عدم إعجاب',
		audio: 'تشغيل الصوت',
		audioRunning: 'الصوت قيد التشغيل',
		audioError: 'خطأ في التشغيل',
		audioLoading: 'جارٍ تحميل الصوت',
	},
	Bubble: { editableOk: 'موافق', editableCancel: 'إلغاء' },
	Mermaid: {
		zoomIn: 'تكبير',
		zoomOut: 'تصغير',
		zoomReset: 'إعادة تعيين',
		download: 'تنزيل',
		code: 'الشيفرة',
		image: 'صورة',
	},
	Folder: {
		selectFile: 'يرجى اختيار ملف',
		loadError: 'تعذّر تحميل الملف',
		noService: 'خدمة محتوى الملفات غير مُهيّأة',
		loadFailed: 'فشل تحميل الملف',
	},
}

export default arEG_X
