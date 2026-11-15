export type LanguageCode = 'en' | 'hi' | 'hinglish';

export interface TranslationKeys {
  tagline: string;
  heroTitle: string;
  searchPlaceholder: string;
  navHome: string;
  navTools: string;
  navFiles: string;
  navHistory: string;
  navSaved: string;
  navProfile: string;
  continueGoogle: string;
  logout: string;
  uploadFile: string;
  chooseFile: string;
  takePhoto: string;
  dropHere: string;
  processing: string;
  download: string;
  share: string;
  processAnother: string;
  tryAgain: string;
  done: string;
  delete: string;
  clearHistory: string;
  exploreTools: string;
  noFilesTitle: string;
  noFilesDesc: string;
  noHistoryTitle: string;
  noHistoryDesc: string;
  noFavoritesTitle: string;
  noFavoritesDesc: string;
  yourFavorites: string;
  popularTools: string;
  categories: string;
  recentlyUsed: string;
  quickActions: string;
}

const en: TranslationKeys = {
  tagline: 'Everything You Need. One Simple Place.',
  heroTitle: 'What do you want to do?',
  searchPlaceholder: 'Search tools...',
  navHome: 'Home',
  navTools: 'Tools',
  navFiles: 'Files',
  navHistory: 'History',
  navSaved: 'Saved',
  navProfile: 'Profile',
  continueGoogle: 'Continue with Google',
  logout: 'Log out',
  uploadFile: 'Upload File',
  chooseFile: 'Choose File',
  takePhoto: 'Take Photo',
  dropHere: 'Drop your file here',
  processing: 'Processing...',
  download: 'Download',
  share: 'Share',
  processAnother: 'Process Another',
  tryAgain: 'Try Again',
  done: 'Done',
  delete: 'Delete',
  clearHistory: 'Clear History',
  exploreTools: 'Explore Tools',
  noFilesTitle: 'No files yet',
  noFilesDesc: 'Your processed files will appear here.',
  noHistoryTitle: 'No recent activity',
  noHistoryDesc: 'Tools you run will appear here.',
  noFavoritesTitle: 'No saved tools yet',
  noFavoritesDesc: 'Tap the star on any tool to keep it handy.',
  yourFavorites: 'Your Favorites',
  popularTools: 'Popular Tools',
  categories: 'Categories',
  recentlyUsed: 'Recently Used',
  quickActions: 'Quick Actions',
};

const hi: TranslationKeys = {
  tagline: 'जो भी आपको चाहिए। एक आसान जगह।',
  heroTitle: 'आप क्या करना चाहते हैं?',
  searchPlaceholder: 'टूल खोजें...',
  navHome: 'होम',
  navTools: 'टूल्स',
  navFiles: 'फ़ाइलें',
  navHistory: 'इतिहास',
  navSaved: 'सेव्ड',
  navProfile: 'प्रोफ़ाइल',
  continueGoogle: 'Google से जारी रखें',
  logout: 'लॉग आउट',
  uploadFile: 'फ़ाइल अपलोड करें',
  chooseFile: 'फ़ाइल चुनें',
  takePhoto: 'फ़ोटो लें',
  dropHere: 'अपनी फ़ाइल यहाँ छोड़ें',
  processing: 'प्रोसेस हो रहा है...',
  download: 'डाउनलोड',
  share: 'शेयर करें',
  processAnother: 'दूसरी फ़ाइल चुनें',
  tryAgain: 'फिर से कोशिश करें',
  done: 'हो गया',
  delete: 'हटाएं',
  clearHistory: 'इतिहास साफ़ करें',
  exploreTools: 'टूल्स देखें',
  noFilesTitle: 'अभी कोई फ़ाइल नहीं',
  noFilesDesc: 'आपकी प्रोसेस की गई फ़ाइलें यहाँ दिखेंगी।',
  noHistoryTitle: 'कोई हालिया गतिविधि नहीं',
  noHistoryDesc: 'आप जो टूल उपयोग करेंगे, वह यहाँ दिखेगा।',
  noFavoritesTitle: 'कोई सेव किया गया टूल नहीं',
  noFavoritesDesc: 'आसान पहुँच के लिए किसी भी टूल पर स्टार दबाएं।',
  yourFavorites: 'आपके पसंदीदा',
  popularTools: 'लोकप्रिय टूल्स',
  categories: 'श्रेणियाँ',
  recentlyUsed: 'हाल ही में उपयोग किए गए',
  quickActions: 'त्वरित कार्य',
};

const hinglish: TranslationKeys = {
  tagline: 'Sab Kuch Jo Chahiye. Ek Simple Jagah.',
  heroTitle: 'Aap kya karna chahte hain?',
  searchPlaceholder: 'Tools search karein...',
  navHome: 'Home',
  navTools: 'Tools',
  navFiles: 'Files',
  navHistory: 'History',
  navSaved: 'Saved',
  navProfile: 'Profile',
  continueGoogle: 'Continue with Google',
  logout: 'Logout karein',
  uploadFile: 'File Upload Karein',
  chooseFile: 'File Chunein',
  takePhoto: 'Photo Lein',
  dropHere: 'Apni file yahan drop karein',
  processing: 'Process ho raha hai...',
  download: 'Download',
  share: 'Share',
  processAnother: 'Ek Aur Karein',
  tryAgain: 'Dobara Try Karein',
  done: 'Done',
  delete: 'Delete',
  clearHistory: 'History Clear Karein',
  exploreTools: 'Tools Dekhein',
  noFilesTitle: 'Abhi koi file nahi hai',
  noFilesDesc: 'Aapki processed files yahan dikhengi.',
  noHistoryTitle: 'Abhi koi activity nahi',
  noHistoryDesc: 'Jo tools aap use karenge wo yahan dikhenge.',
  noFavoritesTitle: 'Koi saved tool nahi',
  noFavoritesDesc: 'Kisi bhi tool par star dabakar yahan save karein.',
  yourFavorites: 'Aapke Favorites',
  popularTools: 'Popular Tools',
  categories: 'Categories',
  recentlyUsed: 'Haal Hi Mein Use Kiye',
  quickActions: 'Quick Actions',
};

const dictionaries: Record<LanguageCode, TranslationKeys> = { en, hi, hinglish };

export function getTranslations(lang: LanguageCode): TranslationKeys {
  return dictionaries[lang] || dictionaries.en;
}
