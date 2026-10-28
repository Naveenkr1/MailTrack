document.addEventListener('DOMContentLoaded', () => {
  let emails = [];
  let ws = null;
  let currentUser = null;
  let activeTab = 'email-tracking';
  let activeFilter = 'all';
  let searchQuery = '';
  let currentActiveDetailId = null;

  // -------------------------------------------------------------
  // THEME MANAGEMENT (Dark / Light)
  // -------------------------------------------------------------
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeText = document.getElementById('themeText');
  const dropdownThemeToggle = document.getElementById('dropdownThemeToggle');
  const dropdownThemeText = document.getElementById('dropdownThemeText');
  const dropdownThemeSwitch = document.getElementById('dropdownThemeSwitch');
  const mobileDropdownThemeToggle = document.getElementById('mobileDropdownThemeToggle');
  const mobileDropdownThemeText = document.getElementById('mobileDropdownThemeText');
  const mobileDropdownThemeSwitch = document.getElementById('mobileDropdownThemeSwitch');

  function initTheme() {
    const savedTheme = localStorage.getItem('mt_theme') || 'light';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mt_theme', theme);
    if (themeText) {
      themeText.textContent = theme === 'dark' ? 'Dark Theme' : 'Light Theme';
    }
    if (dropdownThemeToggle) {
      dropdownThemeToggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
      dropdownThemeToggle.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    if (dropdownThemeSwitch) {
      dropdownThemeSwitch.classList.toggle('active', theme === 'dark');
    }
    if (dropdownThemeText) {
      dropdownThemeText.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    }
    if (mobileDropdownThemeToggle) {
      mobileDropdownThemeToggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
      mobileDropdownThemeToggle.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    if (mobileDropdownThemeSwitch) {
      mobileDropdownThemeSwitch.classList.toggle('active', theme === 'dark');
    }
    if (mobileDropdownThemeText) {
      mobileDropdownThemeText.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    }
  }

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  };

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
  if (dropdownThemeToggle) {
    dropdownThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTheme();
    });
  }
  if (mobileDropdownThemeToggle) {
    mobileDropdownThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTheme();
    });
  }
  initTheme();

  // -------------------------------------------------------------
  // DOM ELEMENTS
  // -------------------------------------------------------------
  const sideDrawer = document.getElementById('sideDrawer');
  const drawerCollapseBtn = document.getElementById('drawerCollapseBtn');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navTabs = document.querySelectorAll('.nav-button, .nav-tab');
  const headerSearchBox = document.getElementById('headerSearchBox');
  const headerFilterContainer = document.getElementById('headerFilterContainer');
  const pageTitleHeading = document.getElementById('pageTitleHeading');
  const pageSubtitle = document.getElementById('pageSubtitle');
  const wsStatus = document.getElementById('wsStatus');

  const tabContentEmailTracking = document.getElementById('tabContentEmailTracking');
  const tabContentActivity = document.getElementById('tabContentActivity');
  const tabContentSettings = document.getElementById('tabContentSettings');
  const tabContentHelp = document.getElementById('tabContentHelp');

  const tabEmailCount = document.getElementById('tabEmailCount');
  const mobileTabEmailCount = document.getElementById('mobileTabEmailCount');
  const activityPulseDot = document.getElementById('activityPulseDot');
  const mobileActivityPulseDot = document.getElementById('mobileActivityPulseDot');
  const mobileProfileBtn = document.getElementById('mobileProfileBtn');
  const mobileUserInitial = document.getElementById('mobileUserInitial');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  const unseenOpenEmailIds = new Set();

  function updateEmailTrackingBadge() {
    const count = unseenOpenEmailIds.size;
    const show = (activeTab !== 'email-tracking' && count > 0);
    if (tabEmailCount) {
      tabEmailCount.style.display = show ? 'inline-block' : 'none';
      tabEmailCount.textContent = count;
    }
    if (mobileTabEmailCount) {
      mobileTabEmailCount.style.display = show ? 'inline-flex' : 'none';
      mobileTabEmailCount.textContent = count;
    }
  }

  // Email Tracking Table Elements
  const emailSearchInput = document.getElementById('emailSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const filterDropdownToggle = document.getElementById('filterDropdownToggle');
  const filterMenuPopover = document.getElementById('filterMenuPopover');
  const activeFilterBadge = document.getElementById('activeFilterBadge');
  const filterMenuItems = document.querySelectorAll('.filter-menu-item, .mobile-filter-chip');
  const countAll = document.getElementById('countAll');
  const mobileCountAll = document.getElementById('mobileCountAll');
  const countOpened = document.getElementById('countOpened');
  const mobileCountOpened = document.getElementById('mobileCountOpened');
  const countUnread = document.getElementById('countUnread');
  const mobileCountUnread = document.getElementById('mobileCountUnread');
  const countClicked = document.getElementById('countClicked');
  const mobileCountClicked = document.getElementById('mobileCountClicked');
  const emailsTableBody = document.getElementById('emailsTableBody');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');

  // Activity Feed Elements
  const activityFeedList = document.getElementById('activityFeedList');

  // User & Settings Elements
  const userProfileBox = document.getElementById('userProfileBox');
  const userMenuArrowBtn = document.getElementById('userMenuArrowBtn');
  const userProfileDropdown = document.getElementById('userProfileDropdown');
  const dropdownGetStarted = document.getElementById('dropdownGetStarted');
  const dropdownPrivacyNotice = document.getElementById('dropdownPrivacyNotice');

  const userAvatar = document.getElementById('userAvatar');
  const userInitial = document.getElementById('userInitial');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userEmailDisplay = document.getElementById('userEmailDisplay');

  // Unified Settings Form Elements
  const unifiedSettingsForm = document.getElementById('unifiedSettingsForm');
  const saveUnifiedSettingsBtn = document.getElementById('saveUnifiedSettingsBtn');
  const unifiedSaveStatus = document.getElementById('unifiedSaveStatus');
  const settingUserName = document.getElementById('settingUserName');
  const settingUserEmail = document.getElementById('settingUserEmail');
  const settingTimezone = document.getElementById('settingTimezone');
  const settingTimeFormat = document.getElementById('settingTimeFormat');
  const mobileCheckmarksToggle = document.getElementById('mobileCheckmarksToggle');
  const soundNotificationToggle = document.getElementById('soundNotificationToggle');
  const soundNotificationBadge = document.getElementById('soundNotificationBadge');
  const testSoundBtn = document.getElementById('testSoundBtn');

  // Modals: Get Started & Privacy Notice
  const getStartedModal = document.getElementById('getStartedModal');
  const closeGetStartedModalBtn = document.getElementById('closeGetStartedModalBtn');
  const dismissGetStartedBtn = document.getElementById('dismissGetStartedBtn');

  const privacyNoticeModal = document.getElementById('privacyNoticeModal');
  const closePrivacyModalBtn = document.getElementById('closePrivacyModalBtn');
  const dismissPrivacyModalBtn = document.getElementById('dismissPrivacyModalBtn');

  // Mobile Sync Prompt Modal & Banner
  const mobileSyncPromptModal = document.getElementById('mobileSyncPromptModal');
  const closeMobilePromptBtn = document.getElementById('closeMobilePromptBtn');
  const dismissMobilePromptBtn = document.getElementById('dismissMobilePromptBtn');
  const mobileSyncBanner = document.getElementById('mobileSyncBanner');
  const closeMobileSyncBanner = document.getElementById('closeMobileSyncBanner');

  // Danger Zone: Delete Account Modal
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteAccountBtn = document.getElementById('confirmDeleteAccountBtn');

  // Details Modal Elements (Legacy Fallback)
  const detailsModal = document.getElementById('detailsModal');
  const closeDetailsModalBtn = document.getElementById('closeDetailsModalBtn');
  const modalStatusBadge = document.getElementById('modalStatusBadge');
  const modalSubject = document.getElementById('modalSubject');
  const modalDetailsBody = document.getElementById('modalDetailsBody');
  const toastContainer = document.getElementById('toastContainer');

  // Email Tracking Details View Elements (Exact Figma Node 82:4805 & Mobile Node 225:13693)
  const backToTrackingListBtn = document.getElementById('backToTrackingListBtn');
  const mobileDetailsBackBtn = document.getElementById('mobileDetailsBackBtn');
  const headerTitleGroup = document.getElementById('headerTitleGroup');
  const headerRightActions = document.getElementById('headerRightActions');
  const emailTableView = document.getElementById('emailTableView');
  const emailTrackingDetailsView = document.getElementById('emailTrackingDetailsView');

  const detEmailSubject = document.getElementById('detEmailSubject');
  const detEmailOpensPill = document.getElementById('detEmailOpensPill');
  const detSentTime = document.getElementById('detSentTime');
  const detSender = document.getElementById('detSender');
  const detTotalOpen = document.getElementById('detTotalOpen');
  const detTotalClick = document.getElementById('detTotalClick');
  const detRecipientSummary = document.getElementById('detRecipientSummary');
  const detRecipientsTableBody = document.getElementById('detRecipientsTableBody');
  const timelineRecipientFilter = document.getElementById('timelineRecipientFilter');
  const detTimelineList = document.getElementById('detTimelineList');
  const detClicksTableBody = document.getElementById('detClicksTableBody');


  // -------------------------------------------------------------
  // SIDE DRAWER & TAB NAVIGATION
  // -------------------------------------------------------------
  if (drawerCollapseBtn && sideDrawer) {
    const updateDrawerBtnTitle = () => {
      const isCollapsed = sideDrawer.classList.contains('collapsed');
      drawerCollapseBtn.setAttribute('title', isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
    };

    drawerCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sideDrawer.classList.toggle('collapsed');
      localStorage.setItem('mt_drawer_collapsed', sideDrawer.classList.contains('collapsed'));
      updateDrawerBtnTitle();
    });

    if (localStorage.getItem('mt_drawer_collapsed') === 'true') {
      sideDrawer.classList.add('collapsed');
      updateDrawerBtnTitle();
    }
  }

  function toggleMobileDrawer(open) {
    if (!sideDrawer) return;
    const shouldOpen = open !== undefined ? open : !sideDrawer.classList.contains('open');
    sideDrawer.classList.toggle('open', shouldOpen);
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.toggle('open', shouldOpen);
    }
  }

  if (mobileMenuBtn && sideDrawer) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileDrawer();
    });
  }

  const mobileProfileContainer = document.getElementById('mobileProfileContainer');
  const mobileProfileDropdown = document.getElementById('mobileProfileDropdown');
  const mobileDropdownGetStarted = document.getElementById('mobileDropdownGetStarted');
  const mobileDropdownPrivacyNotice = document.getElementById('mobileDropdownPrivacyNotice');

  function toggleMobileProfileDropdown(forceState) {
    if (!mobileProfileDropdown) return;
    const shouldOpen = forceState !== undefined ? forceState : !mobileProfileDropdown.classList.contains('open');
    mobileProfileDropdown.classList.toggle('open', shouldOpen);
    if (mobileProfileBtn) {
      mobileProfileBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
    mobileProfileDropdown.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  }

  function closeMobileProfileDropdown() {
    toggleMobileProfileDropdown(false);
  }

  if (mobileProfileBtn) {
    mobileProfileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileProfileDropdown();
    });
  }

  if (mobileDropdownGetStarted) {
    mobileDropdownGetStarted.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileProfileDropdown();
      if (getStartedModal) getStartedModal.classList.add('open');
    });
  }

  if (mobileDropdownPrivacyNotice) {
    mobileDropdownPrivacyNotice.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileProfileDropdown();
      if (privacyNoticeModal) privacyNoticeModal.classList.add('open');
    });
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      toggleMobileDrawer(false);
    });
  }

  document.addEventListener('click', (e) => {
    if (mobileProfileDropdown && mobileProfileDropdown.classList.contains('open')) {
      if (!mobileProfileContainer || !mobileProfileContainer.contains(e.target)) {
        closeMobileProfileDropdown();
      }
    }
    if (window.innerWidth <= 1024 && sideDrawer && sideDrawer.classList.contains('open')) {
      if (!sideDrawer.contains(e.target) && (!mobileMenuBtn || !mobileMenuBtn.contains(e.target))) {
        toggleMobileDrawer(false);
      }
    }
  });

  const tabPanels = {
    'email-tracking': {
      panel: tabContentEmailTracking,
      title: 'Email Tracking',
      subtitle: 'Real-time open & link click analytics'
    },
    'activity': {
      panel: tabContentActivity,
      title: 'Activity Feed',
      subtitle: 'Live stream of recipient interactions and link clicks'
    },
    'settings': {
      panel: tabContentSettings,
      title: 'Settings',
      subtitle: 'Manage your account profile, time format, and mobile sync'
    },
    'help': {
      panel: tabContentHelp,
      title: 'Help & Support',
      subtitle: 'Documentation, beacon architecture, and troubleshooting'
    }
  };

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      if (targetTab === 'email-tracking' && currentActiveDetailId) {
        closeEmailDetails();
      }
      switchTab(targetTab);
      if (window.innerWidth <= 860 && sideDrawer) {
        sideDrawer.classList.remove('open');
      }
    });
  });

  function switchTab(tabKey) {
    if (!tabPanels[tabKey]) return;
    if (currentActiveDetailId && tabKey !== 'email-tracking') {
      closeEmailDetails();
    }
    activeTab = tabKey;

    navTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabKey);
    });

    Object.keys(tabPanels).forEach(key => {
      const item = tabPanels[key];
      if (item.panel) {
        item.panel.classList.toggle('active', key === tabKey);
      }
    });

    const info = tabPanels[tabKey];
    if (pageTitleHeading) pageTitleHeading.textContent = info.title;
    if (pageSubtitle) pageSubtitle.textContent = info.subtitle;

    const isTrackingTab = tabKey === 'email-tracking';
    if (!currentActiveDetailId) {
      if (headerSearchBox) headerSearchBox.style.display = isTrackingTab ? 'flex' : 'none';
      if (headerFilterContainer) headerFilterContainer.style.display = isTrackingTab ? 'block' : 'none';
    }

    if (tabKey === 'activity') {
      if (activityPulseDot) activityPulseDot.style.display = 'none';
      if (mobileActivityPulseDot) mobileActivityPulseDot.style.display = 'none';
      renderActivityFeed();
    } else if (tabKey === 'email-tracking') {
      updateEmailTrackingBadge();
      renderDashboard();
    }
  }

  // -------------------------------------------------------------
  // AUTHENTICATION & USER PROFILE
  // -------------------------------------------------------------
  async function checkAuth() {
    try {
      const res = await fetch('/auth/me');
      if (res.status === 429) {
        console.warn('[MailTrack] /auth/me rate limited, retaining existing session');
        return true;
      }
      if (!res.ok) {
        return false;
      }
      const data = await res.json();
      if (!data.authenticated) {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return false;
      }

      currentUser = data.user;
      populateUserData(currentUser);
      return true;
    } catch {
      return false;
    }
  }

  function populateUserData(user) {
    if (!user) return;

    // Broadcast auth credentials to extension auth-bridge if present
    try {
      window.postMessage({
        type: 'MAILTRACK_AUTH_SUCCESS',
        apiKey: user.apiKey || '',
        email: user.email || '',
        name: user.name || ''
      }, '*');
    } catch {}

    // Ensure WebSocket is authenticated as this active user profile
    if (ws && ws.readyState === WebSocket.OPEN && user.apiKey) {
      try {
        ws.send(JSON.stringify({ type: 'AUTH', token: user.apiKey }));
      } catch {}
    }

    if (userNameDisplay) userNameDisplay.textContent = user.name || 'User';
    if (userEmailDisplay) userEmailDisplay.textContent = user.email || '';

    const mobileDropdownName = document.getElementById('mobileDropdownName');
    const mobileDropdownEmail = document.getElementById('mobileDropdownEmail');
    if (mobileDropdownName) mobileDropdownName.textContent = user.name || 'User';
    if (mobileDropdownEmail) {
      mobileDropdownEmail.textContent = user.email || '';
      mobileDropdownEmail.title = user.email || '';
    }

    const initial = (user.name || user.email || 'U').charAt(0).toUpperCase();

    const mobileUserAvatar = document.getElementById('mobileUserAvatar');

    if (user.avatarUrl && (userAvatar || mobileUserAvatar)) {
      if (userAvatar) {
        userAvatar.src = user.avatarUrl;
        userAvatar.style.display = 'inline-block';
      }
      if (mobileUserAvatar) {
        mobileUserAvatar.src = user.avatarUrl;
        mobileUserAvatar.style.display = 'block';
      }
      if (userInitial) userInitial.style.display = 'none';
      if (mobileUserInitial) mobileUserInitial.style.display = 'none';
    } else {
      if (userInitial) {
        userInitial.textContent = initial;
        userInitial.style.display = 'inline-flex';
      }
      if (mobileUserInitial) {
        mobileUserInitial.textContent = initial;
        mobileUserInitial.style.display = 'inline-flex';
      }
      if (userAvatar) userAvatar.style.display = 'none';
      if (mobileUserAvatar) mobileUserAvatar.style.display = 'none';
    }

    // Populate Settings Form
    if (settingUserName) settingUserName.value = user.name || '';
    if (settingUserEmail) settingUserEmail.value = user.email || '';

    const settings = user.settings || {};
    if (settingTimezone && settings.timezone) {
      settingTimezone.value = settings.timezone;
    }
    if (settingTimeFormat && settings.timeFormat) {
      settingTimeFormat.value = settings.timeFormat;
    }
    if (mobileCheckmarksToggle && typeof settings.mobileAlerts === 'boolean') {
      mobileCheckmarksToggle.checked = settings.mobileAlerts;
    }

    const soundEnabled = (typeof settings.soundNotifications === 'boolean') 
      ? settings.soundNotifications 
      : (localStorage.getItem('mt_sound_notifications') !== 'false');
    if (soundNotificationToggle) soundNotificationToggle.checked = soundEnabled;
    updateSoundBadge(soundEnabled);

    refreshMobileSyncStatus();
  }

  // Sound Notification Toggle Change Handler
  if (soundNotificationToggle) {
    soundNotificationToggle.addEventListener('change', () => {
      const enabled = soundNotificationToggle.checked;
      updateSoundBadge(enabled);
      localStorage.setItem('mt_sound_notifications', enabled ? 'true' : 'false');
      if (enabled) {
        playNotificationSound(true);
      }
    });
  }

  // Test Sound Preview Button Handler
  if (testSoundBtn) {
    testSoundBtn.addEventListener('click', () => {
      testSoundBtn.classList.add('playing');
      playNotificationSound(true);
      setTimeout(() => {
        if (testSoundBtn) testSoundBtn.classList.remove('playing');
      }, 550);
    });
  }

  // -------------------------------------------------------------
  // SINGLE UNIFIED SETTINGS FORM SUBMISSION
  // -------------------------------------------------------------
  if (unifiedSettingsForm) {
    unifiedSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = settingUserName.value.trim();
      const timezone = settingTimezone ? settingTimezone.value : 'auto';
      const timeFormat = settingTimeFormat ? settingTimeFormat.value : '12h';
      const mobileAlerts = mobileCheckmarksToggle ? mobileCheckmarksToggle.checked : true;
      const soundNotifications = soundNotificationToggle ? soundNotificationToggle.checked : true;

      if (!newName) return;

      if (saveUnifiedSettingsBtn) saveUnifiedSettingsBtn.disabled = true;
      if (unifiedSaveStatus) {
        unifiedSaveStatus.textContent = 'Saving settings...';
        unifiedSaveStatus.style.color = 'var(--text-subtitle)';
      }

      try {
        const res = await fetch('/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName,
            timezone,
            timeFormat,
            mobileAlerts,
            soundNotifications
          })
        });
        const data = await res.json();
        if (data.success && data.user) {
          currentUser = data.user;
          localStorage.setItem('mt_sound_notifications', soundNotifications ? 'true' : 'false');
          populateUserData(currentUser);
          if (unifiedSaveStatus) {
            unifiedSaveStatus.textContent = 'Settings saved successfully!';
            unifiedSaveStatus.style.color = 'var(--color-green)';
            setTimeout(() => { if (unifiedSaveStatus) unifiedSaveStatus.textContent = ''; }, 3500);
          }
          renderDashboard();
          if (activeTab === 'activity') renderActivityFeed();
        } else {
          throw new Error('Save failed');
        }
      } catch (err) {
        if (unifiedSaveStatus) {
          unifiedSaveStatus.textContent = 'Failed to save settings.';
          unifiedSaveStatus.style.color = '#ef4444';
        }
      } finally {
        if (saveUnifiedSettingsBtn) saveUnifiedSettingsBtn.disabled = false;
      }
    });
  }



  // -------------------------------------------------------------
  // NAVBAR USER PROFILE DROPDOWN (Upward Popover) & MODALS
  // -------------------------------------------------------------
  function toggleUserDropdown(e) {
    if (e) e.stopPropagation();
    if (!userProfileDropdown) return;
    const isOpen = userProfileDropdown.classList.contains('open');
    if (isOpen) {
      closeUserDropdown();
    } else {
      userProfileDropdown.classList.add('open');
      if (userProfileBox) userProfileBox.classList.add('active');
    }
  }

  function closeUserDropdown() {
    if (userProfileDropdown) userProfileDropdown.classList.remove('open');
    if (userProfileBox) userProfileBox.classList.remove('active');
  }

  if (userProfileBox) {
    userProfileBox.addEventListener('click', toggleUserDropdown);
  }
  if (userMenuArrowBtn) {
    userMenuArrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUserDropdown(e);
    });
  }

  document.addEventListener('click', (e) => {
    if (userProfileDropdown && userProfileDropdown.classList.contains('open')) {
      if (!userProfileDropdown.contains(e.target) && !userProfileBox.contains(e.target)) {
        closeUserDropdown();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeUserDropdown();
      if (getStartedModal) getStartedModal.classList.remove('open');
      if (privacyNoticeModal) privacyNoticeModal.classList.remove('open');
      if (deleteConfirmModal) deleteConfirmModal.classList.remove('open');
      if (detailsModal) detailsModal.classList.remove('open');
      if (mobileSyncPromptModal) mobileSyncPromptModal.classList.remove('open');
    }
  });

  // Get Started Modal Trigger
  if (dropdownGetStarted) {
    dropdownGetStarted.addEventListener('click', (e) => {
      e.stopPropagation();
      closeUserDropdown();
      if (getStartedModal) getStartedModal.classList.add('open');
    });
  }
  if (closeGetStartedModalBtn) {
    closeGetStartedModalBtn.addEventListener('click', () => {
      if (getStartedModal) getStartedModal.classList.remove('open');
    });
  }
  if (dismissGetStartedBtn) {
    dismissGetStartedBtn.addEventListener('click', () => {
      if (getStartedModal) getStartedModal.classList.remove('open');
    });
  }
  if (getStartedModal) {
    getStartedModal.addEventListener('click', (e) => {
      if (e.target === getStartedModal) getStartedModal.classList.remove('open');
    });
  }

  // Privacy Notice Modal Trigger
  if (dropdownPrivacyNotice) {
    dropdownPrivacyNotice.addEventListener('click', (e) => {
      e.stopPropagation();
      closeUserDropdown();
      if (privacyNoticeModal) privacyNoticeModal.classList.add('open');
    });
  }
  if (closePrivacyModalBtn) {
    closePrivacyModalBtn.addEventListener('click', () => {
      if (privacyNoticeModal) privacyNoticeModal.classList.remove('open');
    });
  }
  if (dismissPrivacyModalBtn) {
    dismissPrivacyModalBtn.addEventListener('click', () => {
      if (privacyNoticeModal) privacyNoticeModal.classList.remove('open');
    });
  }
  if (privacyNoticeModal) {
    privacyNoticeModal.addEventListener('click', (e) => {
      if (e.target === privacyNoticeModal) privacyNoticeModal.classList.remove('open');
    });
  }

  // Help & Support Interactive Triggers
  const helpOpenGuideBtn = document.getElementById('helpOpenGuideBtn');
  const helpCheckHealthBtn = document.getElementById('helpCheckHealthBtn');
  const helpOpenPrivacyBtn = document.getElementById('helpOpenPrivacyBtn');

  if (helpOpenGuideBtn) {
    helpOpenGuideBtn.addEventListener('click', () => {
      if (getStartedModal) getStartedModal.classList.add('open');
    });
  }

  if (helpOpenPrivacyBtn) {
    helpOpenPrivacyBtn.addEventListener('click', () => {
      if (privacyNoticeModal) privacyNoticeModal.classList.add('open');
    });
  }

  if (helpCheckHealthBtn) {
    helpCheckHealthBtn.addEventListener('click', async () => {
      helpCheckHealthBtn.disabled = true;
      const originalText = helpCheckHealthBtn.textContent;
      helpCheckHealthBtn.textContent = 'Pinging...';
      const start = performance.now();
      try {
        const res = await fetch('/health');
        const latency = Math.round(performance.now() - start);
        if (res.ok) {
          helpCheckHealthBtn.textContent = `Online (${latency}ms)`;
          setTimeout(() => {
            helpCheckHealthBtn.textContent = originalText;
            helpCheckHealthBtn.disabled = false;
          }, 3000);
        } else {
          helpCheckHealthBtn.textContent = 'Degraded';
          setTimeout(() => {
            helpCheckHealthBtn.textContent = originalText;
            helpCheckHealthBtn.disabled = false;
          }, 3000);
        }
      } catch {
        helpCheckHealthBtn.textContent = 'Offline';
        setTimeout(() => {
          helpCheckHealthBtn.textContent = originalText;
          helpCheckHealthBtn.disabled = false;
        }, 3000);
      }
    });
  }

  const mobileSyncStatusBadge = document.getElementById('mobileSyncStatusBadge');
  const mobileSyncDesc = document.getElementById('mobileSyncDesc');
  const connectMobileGmailBtn = document.getElementById('connectMobileGmailBtn');
  const syncExistingMobileBtn = document.getElementById('syncExistingMobileBtn');
  const autoSyncStatusIndicator = document.getElementById('autoSyncStatusIndicator');
  let lastClientAutoSyncTime = 0;

  async function refreshMobileSyncStatus() {
    try {
      const res = await fetch('/api/mobile-sync/status');
      const data = await res.json();
      if (data && data.success) {
        if (data.connected) {
          if (mobileSyncStatusBadge) {
            mobileSyncStatusBadge.textContent = 'Active (Auto-Syncing)';
            mobileSyncStatusBadge.className = 'sync-active-badge connected';
          }
          if (mobileSyncDesc) {
            const emailStr = escapeHtml(data.email || (currentUser && currentUser.email) || '');
            mobileSyncDesc.innerHTML = `
              Gmail mobile sync is active for your connected Gmail account (${emailStr ? `<span class="sync-account-email">${emailStr}</span>` : 'your account'}). All sent and opened emails are <strong>automatically synced in real-time</strong> in the background (no button press required).
            `;
          }
          if (connectMobileGmailBtn) connectMobileGmailBtn.style.display = 'none';
          if (autoSyncStatusIndicator) autoSyncStatusIndicator.style.display = 'inline-flex';
          if (syncExistingMobileBtn) syncExistingMobileBtn.style.display = 'inline-flex';
          if (mobileSyncBanner) mobileSyncBanner.style.display = 'none';

          // Automatic background sync without needing button click (debounced)
          const now = Date.now();
          if (now - lastClientAutoSyncTime > 30000) {
            lastClientAutoSyncTime = now;
            fetch('/api/mobile-sync/sync-now', { method: 'POST' }).catch(() => {});
          }
        } else {
          if (mobileSyncStatusBadge) {
            mobileSyncStatusBadge.textContent = 'Connection Required';
            mobileSyncStatusBadge.className = 'sync-active-badge disconnected';
          }
          if (mobileSyncDesc) {
            mobileSyncDesc.innerHTML = `
              Connect your Google account with Gmail permissions to enable mobile checkmarks. Sent emails show a single checkmark when delivered and a green double checkmark when opened in the Gmail mobile app.
            `;
          }
          if (connectMobileGmailBtn) connectMobileGmailBtn.style.display = 'inline-flex';
          if (autoSyncStatusIndicator) autoSyncStatusIndicator.style.display = 'none';
          if (syncExistingMobileBtn) syncExistingMobileBtn.style.display = 'none';

          // Show callout banner if not dismissed in this session
          if (mobileSyncBanner && sessionStorage.getItem('mt_dismissed_mobile_banner') !== 'true') {
            mobileSyncBanner.style.display = 'flex';
          }

          // First-time prompt modal: ask user to Enable Mobile Checkmarks on first login
          if (mobileSyncPromptModal && !localStorage.getItem('mt_dismissed_mobile_modal')) {
            setTimeout(() => {
              mobileSyncPromptModal.classList.add('open');
            }, 700);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch mobile sync status:', e);
    }
  }

  // Periodic continuous auto-sync while dashboard is open (every 40s)
  setInterval(() => {
    if (currentUser && mobileSyncStatusBadge && mobileSyncStatusBadge.classList.contains('connected')) {
      fetch('/api/mobile-sync/sync-now', { method: 'POST' }).catch(() => {});
    }
  }, 40000);

  // Dismiss mobile banner handler
  if (closeMobileSyncBanner) {
    closeMobileSyncBanner.addEventListener('click', () => {
      if (mobileSyncBanner) mobileSyncBanner.style.display = 'none';
      sessionStorage.setItem('mt_dismissed_mobile_banner', 'true');
    });
  }

  // Dismiss first-time mobile prompt modal handlers
  const dismissMobilePrompt = () => {
    if (mobileSyncPromptModal) mobileSyncPromptModal.classList.remove('open');
    localStorage.setItem('mt_dismissed_mobile_modal', 'true');
  };

  if (closeMobilePromptBtn) closeMobilePromptBtn.addEventListener('click', dismissMobilePrompt);
  if (dismissMobilePromptBtn) dismissMobilePromptBtn.addEventListener('click', dismissMobilePrompt);
  if (mobileSyncPromptModal) {
    mobileSyncPromptModal.addEventListener('click', (e) => {
      if (e.target === mobileSyncPromptModal) dismissMobilePrompt();
    });
  }

  if (syncExistingMobileBtn) {
    syncExistingMobileBtn.addEventListener('click', async () => {
      syncExistingMobileBtn.disabled = true;
      const originalText = syncExistingMobileBtn.innerHTML;
      syncExistingMobileBtn.innerHTML = `<span>Syncing with Gmail...</span>`;
      try {
        const res = await fetch('/api/mobile-sync/sync-now', { method: 'POST' });
        const data = await res.json();
        if (data && data.success) {
          showToastNotification({
            title: '✓✓ Mobile Sync Complete!',
            subtitle: `Successfully synced ${data.count} of ${data.total} tracked emails with checkmarks in Gmail!`,
            timestamp: new Date().toISOString()
          });
          refreshMobileSyncStatus();
        } else {
          showToastNotification({
            title: 'Sync Notice',
            subtitle: data.error || 'Could not complete sync. Please ensure Gmail permissions are granted.',
            timestamp: new Date().toISOString()
          });
        }
      } catch (err) {
        showToastNotification({
          title: 'Sync Error',
          subtitle: err.message,
          timestamp: new Date().toISOString()
        });
      } finally {
        syncExistingMobileBtn.disabled = false;
        syncExistingMobileBtn.innerHTML = originalText;
      }
    });
  }

  if (mobileCheckmarksToggle) {
    mobileCheckmarksToggle.addEventListener('change', async () => {
      const isChecked = mobileCheckmarksToggle.checked;
      try {
        await fetch('/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mobileAlerts: isChecked })
        });
        showToastNotification({
          title: isChecked ? 'Mobile Checkmarks Enabled' : 'Mobile Checkmarks Disabled',
          subtitle: isChecked ? 'Read receipts (✓✓) will sync to phone.' : 'Mobile indicators turned off.',
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('Failed to update mobile checkmark status:', e);
      }
    });
  }

  // -------------------------------------------------------------
  // DANGER ZONE: DELETE ACCOUNT & ALL DATA
  // -------------------------------------------------------------
  if (deleteAccountBtn && deleteConfirmModal) {
    deleteAccountBtn.addEventListener('click', () => {
      deleteConfirmModal.classList.add('open');
    });

    const closeModal = () => deleteConfirmModal.classList.remove('open');
    if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener('click', closeModal);
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeModal);
    deleteConfirmModal.addEventListener('click', (e) => {
      if (e.target === deleteConfirmModal) closeModal();
    });

    if (confirmDeleteAccountBtn) {
      confirmDeleteAccountBtn.addEventListener('click', async () => {
        confirmDeleteAccountBtn.disabled = true;
        confirmDeleteAccountBtn.textContent = 'Deleting account & all data...';
        try {
          const res = await fetch('/auth/account', { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            window.location.href = '/login?notice=Account+and+all+data+permanently+deleted';
          } else {
            alert('Error deleting account: ' + (data.message || 'Unknown error'));
            confirmDeleteAccountBtn.disabled = false;
            confirmDeleteAccountBtn.textContent = 'Yes, Permanently Delete';
          }
        } catch (err) {
          alert('Network error while deleting account.');
          confirmDeleteAccountBtn.disabled = false;
          confirmDeleteAccountBtn.textContent = 'Yes, Permanently Delete';
        }
      });
    }
  }

  // -------------------------------------------------------------
  // EMAILS FETCH & LIVE WEBSOCKET
  // -------------------------------------------------------------
  async function loadEmails(silent = false) {
    try {
      const res = await fetch('/api/emails');
      if (res.status === 401) {
        if (!silent) window.location.href = '/login';
        return;
      }
      const data = await res.json();
      if (data.success) {
        if (silent && emails.length > 0) {
          const prevMap = new Map(emails.map(e => [e.id, (e.openCount || (e.opens ? e.opens.length : 0))]));
          const incoming = data.emails || [];
          for (const ne of incoming) {
            const prevCount = prevMap.get(ne.id);
            const newCount = ne.openCount || (ne.opens ? ne.opens.length : 0);
            if (prevCount !== undefined && newCount > prevCount) {
              playNotificationSound();
              showToastNotification({
                title: 'Email Opened!',
                subtitle: `"${ne.subject}" was read by ${ne.recipient}`,
                timestamp: new Date().toISOString()
              });
              ne.isNewOpen = true;
              unseenOpenEmailIds.add(ne.id);
              updateEmailTrackingBadge();
              break;
            }
          }
        }
        emails = data.emails || [];
        renderDashboard();
        if (activeTab === 'activity') renderActivityFeed();

        // Check if deep link to a specific email's detailed page was requested (only on initial load)
        if (!silent) {
          const targetEmailId = urlParams.get('emailId') || urlParams.get('id');
          if (targetEmailId) {
            openEmailDetails(targetEmailId);
          }
        }
      }
    } catch (err) {
      if (!silent) console.error('Failed to load emails:', err);
    }
  }

  let wsReconnectAttempts = 0;
  let smartPollInterval = null;

  function enableSmartPolling() {
    if (smartPollInterval) return;
    if (wsStatus) {
      wsStatus.classList.add('connected');
      const label = wsStatus.querySelector('.status-label');
      if (label) label.textContent = 'Live Cloud Sync';
    }
    // Poll every 5s if tab is visible in browser
    smartPollInterval = setInterval(() => {
      if (!document.hidden && currentUser) {
        loadEmails(true);
      }
    }, 5000);
  }

  function connectWebSocket() {
    // If we've determined we're on serverless hosting (e.g. Vercel), stay in smart polling
    if (wsReconnectAttempts >= 2) {
      enableSmartPolling();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const authQuery = currentUser && currentUser.apiKey ? `?apiKey=${encodeURIComponent(currentUser.apiKey)}` : '';
    const wsUrl = `${protocol}//${window.location.host}${authQuery}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsReconnectAttempts = 0;
        if (smartPollInterval) {
          clearInterval(smartPollInterval);
          smartPollInterval = null;
        }
        if (wsStatus) {
          wsStatus.classList.add('connected');
          wsStatus.querySelector('.status-label').textContent = 'Live Connected';
        }
        // Send AUTH message immediately on connection if user profile is loaded
        if (currentUser && currentUser.apiKey) {
          try {
            ws.send(JSON.stringify({ type: 'AUTH', token: currentUser.apiKey }));
          } catch {}
        }
      };

      ws.onclose = () => {
        wsReconnectAttempts++;
        if (wsReconnectAttempts >= 2) {
          console.log('[Dashboard] WebSocket not available on serverless host. Activating Live Cloud Sync.');
          enableSmartPolling();
          return;
        }
        if (wsStatus) {
          wsStatus.classList.remove('connected');
          wsStatus.querySelector('.status-label').textContent = 'Connecting...';
        }
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        // Handled via onclose
      };

      ws.onmessage = event => {
        try {
          const payload = JSON.parse(event.data);
          handleWsMessage(payload);
        } catch (e) {
          console.error('Failed to parse WS msg:', e);
        }
      };
    } catch (e) {
      enableSmartPolling();
    }
  }

  function handleWsMessage(payload) {
    if (!payload || !payload.type) return;
    const { type, data } = payload;
    if (!data) return;

    // Strict account isolation: verify event belongs to this logged-in account
    const eventEmail = data.email || null;
    const eventUserId = (eventEmail && eventEmail.userId) || data.userId || null;

    if (currentUser && currentUser.id) {
      if (eventUserId && eventUserId !== currentUser.id) {
        console.warn(`[MailTrack WS] Dropped event for other user account (${eventUserId}). Current profile: ${currentUser.id}`);
        return;
      }
    } else {
      // If user profile is not yet loaded, never process user-specific notifications
      if (type === 'EMAIL_OPENED' || type === 'LINK_CLICKED' || type === 'EMAIL_CREATED' || type === 'EMAIL_DELETED') {
        return;
      }
    }

    if (type === 'EMAIL_OPENED') {
      const { email, event } = data;
      if (!email) return;

      // Defense-in-depth: Never show notification or increment count if email belongs to another profile
      if (currentUser && email.userId && email.userId !== currentUser.id) {
        return;
      }

      showToastNotification({
        title: 'Email Opened!',
        subtitle: `"${email.subject}" was read by ${email.recipient}`,
        timestamp: event.timestamp
      });

      // Mark this email as newly opened and record unseen open
      email.isNewOpen = true;
      unseenOpenEmailIds.add(email.id);

      const idx = emails.findIndex(e => e.id === email.id);
      if (idx !== -1) emails[idx] = email;
      else emails.unshift(email);

      renderDashboard();
      updateEmailTrackingBadge();

      // If user is actively on email-tracking screen, let them see the red dot, then auto-mark seen
      if (activeTab === 'email-tracking') {
        setTimeout(() => {
          if (email.isNewOpen) {
            email.isNewOpen = false;
            unseenOpenEmailIds.delete(email.id);
            updateEmailTrackingBadge();
            renderDashboard();
          }
        }, 8000);
      }

      if (activeTab === 'activity') {
        renderActivityFeed();
      } else {
        if (activityPulseDot) activityPulseDot.style.display = 'inline-block';
        if (mobileActivityPulseDot) mobileActivityPulseDot.style.display = 'inline-block';
      }

      playNotificationSound();

      if (currentActiveDetailId === email.id) {
        openEmailDetails(email.id);
      }
    } else if (type === 'LINK_CLICKED') {
      const { email, event } = data;
      if (email && currentUser && email.userId && email.userId !== currentUser.id) {
        return;
      }

      showToastNotification({
        title: 'Link Clicked!',
        subtitle: `"${email ? email.recipient : 'Recipient'}" clicked: ${event.url}`,
        timestamp: event.timestamp
      });

      if (email) {
        const idx = emails.findIndex(e => e.id === email.id);
        if (idx !== -1) emails[idx] = email;
        else emails.unshift(email);

        renderDashboard();
        if (activeTab === 'activity') {
          renderActivityFeed();
        } else {
          if (activityPulseDot) activityPulseDot.style.display = 'inline-block';
          if (mobileActivityPulseDot) mobileActivityPulseDot.style.display = 'inline-block';
        }

        if (currentActiveDetailId === email.id) {
          openEmailDetails(email.id);
        }
      }
      playNotificationSound();
    } else if (type === 'EMAIL_CREATED') {
      const { email } = data;
      if (!email || (currentUser && email.userId && email.userId !== currentUser.id)) {
        return;
      }
      const idx = emails.findIndex(e => e.id === email.id);
      if (idx === -1) emails.unshift(email);
      renderDashboard();
      if (activeTab === 'activity') renderActivityFeed();
    } else if (type === 'EMAIL_DELETED') {
      const { id } = data;
      if (id) {
        emails = emails.filter(e => e.id !== id);
        unseenOpenEmailIds.delete(id);
        renderDashboard();
        updateEmailTrackingBadge();
        if (activeTab === 'activity') renderActivityFeed();
      }
    } else if (type === 'ALL_CLEARED') {
      emails = [];
      unseenOpenEmailIds.clear();
      renderDashboard();
      updateEmailTrackingBadge();
      if (activeTab === 'activity') renderActivityFeed();
    }
  }

  let sharedAudioCtx = null;
  function getAudioContext() {
    if (!sharedAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  }

  // Pre-unlock AudioContext on first user interaction so sounds play seamlessly
  const unlockAudioOnGesture = () => {
    getAudioContext();
    document.removeEventListener('click', unlockAudioOnGesture);
    document.removeEventListener('keydown', unlockAudioOnGesture);
    document.removeEventListener('touchstart', unlockAudioOnGesture);
  };
  document.addEventListener('click', unlockAudioOnGesture, { passive: true });
  document.addEventListener('keydown', unlockAudioOnGesture, { passive: true });
  document.addEventListener('touchstart', unlockAudioOnGesture, { passive: true });

  function isSoundNotificationEnabled() {
    const localVal = localStorage.getItem('mt_sound_notifications');
    if (localVal !== null) {
      return localVal === 'true';
    }
    if (currentUser && currentUser.settings && typeof currentUser.settings.soundNotifications === 'boolean') {
      return currentUser.settings.soundNotifications;
    }
    return true; // Enabled by default
  }

  function updateSoundBadge(enabled) {
    if (!soundNotificationBadge) return;
    if (enabled) {
      soundNotificationBadge.textContent = 'Active';
      soundNotificationBadge.className = 'sync-active-badge connected';
    } else {
      soundNotificationBadge.textContent = 'Muted';
      soundNotificationBadge.className = 'sync-active-badge disconnected';
    }
  }

  function playNotificationSound(force = false) {
    if (!force && !isSoundNotificationEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;

      // Note 1: 587.33 Hz (D5) - warm bell chime
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.25);

      // Note 2: 880 Hz (A5) - uplifting melodic second tone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(0.14, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.45);
    } catch (e) {
      console.warn('Notification audio notice:', e);
    }
  }

  function showToastNotification({ title, subtitle, timestamp }) {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast-card';
    const timeFormatted = formatTime(timestamp);

    toast.innerHTML = `
      <div class="toast-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <div class="toast-content">
        <span class="toast-title">${escapeHtml(title)}</span>
        <span class="toast-sub">${escapeHtml(subtitle)}</span>
        <span class="toast-time">${timeFormatted}</span>
      </div>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    }, 5000);
  }

  // -------------------------------------------------------------
  // SEARCH & FILTER LOGIC
  // -------------------------------------------------------------
  const mobileEmailSearchInput = document.getElementById('mobileEmailSearchInput');
  const mobileClearSearchBtn = document.getElementById('mobileClearSearchBtn');

  if (emailSearchInput) {
    emailSearchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      if (mobileEmailSearchInput) mobileEmailSearchInput.value = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = searchQuery ? 'inline-flex' : 'none';
      }
      if (mobileClearSearchBtn) {
        mobileClearSearchBtn.style.display = searchQuery ? 'inline-flex' : 'none';
      }
      renderDashboard();
    });
  }

  if (clearSearchBtn && emailSearchInput) {
    clearSearchBtn.addEventListener('click', () => {
      emailSearchInput.value = '';
      if (mobileEmailSearchInput) mobileEmailSearchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      if (mobileClearSearchBtn) mobileClearSearchBtn.style.display = 'none';
      emailSearchInput.focus();
      renderDashboard();
    });
  }

  if (mobileEmailSearchInput) {
    mobileEmailSearchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      if (emailSearchInput) emailSearchInput.value = e.target.value;
      if (mobileClearSearchBtn) {
        mobileClearSearchBtn.style.display = searchQuery ? 'inline-flex' : 'none';
      }
      if (clearSearchBtn) {
        clearSearchBtn.style.display = searchQuery ? 'inline-flex' : 'none';
      }
      renderDashboard();
    });
  }

  if (mobileClearSearchBtn && mobileEmailSearchInput) {
    mobileClearSearchBtn.addEventListener('click', () => {
      mobileEmailSearchInput.value = '';
      if (emailSearchInput) emailSearchInput.value = '';
      searchQuery = '';
      mobileClearSearchBtn.style.display = 'none';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      mobileEmailSearchInput.focus();
      renderDashboard();
    });
  }

  if (filterDropdownToggle && filterMenuPopover) {
    filterDropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      filterMenuPopover.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!filterMenuPopover.contains(e.target) && !filterDropdownToggle.contains(e.target)) {
        filterMenuPopover.classList.remove('open');
      }
    });
  }

  filterMenuItems.forEach(item => {
    item.addEventListener('click', () => {
      activeFilter = item.dataset.filter || 'all';
      filterMenuItems.forEach(m => {
        const isMatch = (m.dataset.filter || 'all') === activeFilter;
        m.classList.toggle('active', isMatch);
        const chipCount = m.querySelector('.chip-count');
        if (chipCount && m.classList.contains('mobile-filter-chip')) {
          chipCount.style.display = isMatch ? 'inline-block' : 'none';
        }
      });
      if (activeFilterBadge) {
        const labels = { all: 'All', opened: 'Opened', unopened: 'Unread', clicked: 'Clicked' };
        activeFilterBadge.textContent = labels[activeFilter] || 'All';
      }
      if (filterMenuPopover) {
        filterMenuPopover.classList.remove('open');
      }
      renderDashboard();
    });
  });

  function getFilteredEmails() {
    return emails.filter(email => {
      const isOpened = email.status === 'opened' || (email.opens && email.opens.length > 0);
      const isClicked = email.clicks && email.clicks.length > 0;

      // Filter chip matching
      if (activeFilter === 'opened' && !isOpened) return false;
      if (activeFilter === 'unopened' && isOpened) return false;
      if (activeFilter === 'clicked' && !isClicked) return false;

      // Search query matching
      if (searchQuery) {
        const subjectMatch = (email.subject || '').toLowerCase().includes(searchQuery);
        const recipientMatch = (email.recipient || '').toLowerCase().includes(searchQuery);
        const recipientsArrayMatch = (email.recipients || []).some(r => r.toLowerCase().includes(searchQuery));
        if (!subjectMatch && !recipientMatch && !recipientsArrayMatch) {
          return false;
        }
      }

      return true;
    });
  }

  // -------------------------------------------------------------
  // DASHBOARD TABLE RENDERING
  // -------------------------------------------------------------
  function renderDashboard() {
    const totalCount = emails.length;
    updateEmailTrackingBadge();

    // Calculate counts for filters
    const openedEmails = emails.filter(e => e.status === 'opened' || (e.opens && e.opens.length > 0));
    const unreadEmails = emails.filter(e => e.status !== 'opened' && (!e.opens || e.opens.length === 0));
    const clickedEmails = emails.filter(e => e.clicks && e.clicks.length > 0);

    if (countAll) countAll.textContent = totalCount;
    if (mobileCountAll) mobileCountAll.textContent = totalCount;
    if (countOpened) countOpened.textContent = openedEmails.length;
    if (mobileCountOpened) mobileCountOpened.textContent = openedEmails.length;
    if (countUnread) countUnread.textContent = unreadEmails.length;
    if (mobileCountUnread) mobileCountUnread.textContent = unreadEmails.length;
    if (countClicked) countClicked.textContent = clickedEmails.length;
    if (mobileCountClicked) mobileCountClicked.textContent = clickedEmails.length;

    const filtered = getFilteredEmails();

    if (filtered.length === 0) {
      emailsTableBody.innerHTML = '';
      if (emptyState) {
        emptyState.style.display = 'block';
        if (searchQuery || activeFilter !== 'all') {
          if (emptyTitle) emptyTitle.textContent = 'No matching emails';
          if (emptyDesc) emptyDesc.textContent = 'Try adjusting your search query or filter chips to view other tracked emails.';
        } else {
          if (emptyTitle) emptyTitle.textContent = 'No tracked emails yet';
          if (emptyDesc) emptyDesc.textContent = 'Send an email from Gmail with Mail Track enabled to view real-time tracking receipts here.';
        }
      }
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    emailsTableBody.innerHTML = filtered.map(email => {
      const isOpened = email.status === 'opened' || (email.opens && email.opens.length > 0);
      const openCount = email.opens ? email.opens.length : (email.openCount || 0);
      const clickCount = email.clicks ? email.clicks.length : (email.clickCount || 0);
      const sentDateStr = formatDate(email.createdAt);

      const lastOpenTime = email.lastOpenedAt || (email.opens && email.opens.length ? email.opens[email.opens.length - 1].timestamp : null);

      // Red dot indication: only show if the new email was opened and not yet seen by the user
      const showRedDot = Boolean(email.isNewOpen && unseenOpenEmailIds.has(email.id));

      const recList = Array.isArray(email.recipients) && email.recipients.length > 0 
        ? email.recipients 
        : (email.recipient ? email.recipient.split(/[,;]+/).map(s => s.trim()).filter(Boolean) : ['Recipient']);

      const displayedRecs = recList.slice(0, 2);
      const remainingRecs = recList.length - 2;

      const recText = displayedRecs.map(r => escapeHtml(r)).join(', ') + (remainingRecs > 0 ? ` +${remainingRecs}` : '');
      const recChipsHtml = `<span class="rec-chip" title="${escapeHtml(recList.join(', '))}">${recText}</span>`;

      const opensBadgeHtml = openCount > 0
        ? `<span class="figma-badge badge-opened">${openCount} open${openCount > 1 ? 's' : ''}</span>`
        : `<span class="figma-badge badge-unread">Unread</span>`;

      const clicksHtml = `<span class="cell-clicks">${clickCount > 0 ? `${clickCount} Clicks` : '0 Clicks'}</span>`;

      const lastOpenedHtml = lastOpenTime
        ? `<span class="cell-last-opened">${formatDate(lastOpenTime)}</span>`
        : `<span class="cell-dash">-</span>`;

      return `
        <tr class="email-row-clickable" data-id="${email.id}">
          <td class="cell-sent-at">
            <span class="sent-time-label">Sent at: </span>
            <span class="sent-time-val">${sentDateStr}</span>
          </td>
          <td class="td-subject-cell">
            <div class="card-subject-content">
              <div class="subject-line-row">
                <span class="subject-title-text">${escapeHtml(email.subject || '(No Subject)')}</span>
                ${showRedDot ? `<span class="figma-red-dot" title="Recent activity"></span>` : ''}
              </div>
              <div class="recipient-chips-row">
                ${recChipsHtml}
              </div>
            </div>
            <div class="card-chevron-col">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M6.75 13.5L11.25 9L6.75 4.5" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </td>
          <td class="cell-opens">${opensBadgeHtml}</td>
          <td class="cell-clicks-col">${clicksHtml}</td>
          <td class="cell-last-opened-col">${lastOpenedHtml}</td>
          <td class="card-footer-stats-cell">
            <div class="card-footer-left-badges">
              ${opensBadgeHtml}
              ${clickCount > 0 ? clicksHtml : ''}
            </div>
            <div class="card-last-opened-group">
              <span class="last-opened-label">Last Opened</span>
              <span class="last-opened-time">${lastOpenTime ? formatDate(lastOpenTime) : '-'}</span>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.email-row-clickable').forEach(row => {
      row.onclick = () => openEmailDetails(row.dataset.id);
    });
  }

  function parseRecipientList(recRaw) {
    if (!recRaw) return [];
    if (Array.isArray(recRaw)) {
      return recRaw.flatMap(r => parseRecipientList(r));
    }
    return String(recRaw).split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  }

  // -------------------------------------------------------------
  // ACTIVITY FEED TAB RENDERING
  // -------------------------------------------------------------
  function renderActivityFeed() {
    if (!activityFeedList) return;

    // Aggregate all opens and clicks across emails, separating multiple recipients into individual events
    const events = [];
    emails.forEach(email => {
      const emailRecList = Array.isArray(email.recipients) && email.recipients.length > 0 
        ? email.recipients 
        : parseRecipientList(email.recipient);

      (email.opens || []).forEach((open, idx) => {
        let recs = parseRecipientList(open.recipient);
        if (recs.length === 0) {
          recs = [emailRecList[idx % (emailRecList.length || 1)] || emailRecList[0] || 'Recipient'];
        }

        recs.forEach(singleRec => {
          events.push({
            type: 'open',
            emailId: email.id,
            subject: email.subject,
            recipient: singleRec,
            client: formatDeviceName(open.client || 'Desktop'),
            timestamp: open.timestamp
          });
        });
      });

      (email.clicks || []).forEach((click, idx) => {
        let recs = parseRecipientList(click.recipient);
        if (recs.length === 0) {
          recs = [emailRecList[idx % (emailRecList.length || 1)] || emailRecList[0] || 'Recipient'];
        }

        recs.forEach(singleRec => {
          events.push({
            type: 'click',
            emailId: email.id,
            subject: email.subject,
            recipient: singleRec,
            url: click.url,
            timestamp: click.timestamp
          });
        });
      });
    });

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (events.length === 0) {
      activityFeedList.innerHTML = `
        <div class="activity-empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <h4>No activity events recorded yet</h4>
          <p>When recipients open your tracked emails or click embedded links, live activity receipts will appear here in real time.</p>
        </div>
      `;
      return;
    }

    activityFeedList.innerHTML = events.map(evt => {
      const isClick = evt.type === 'click';
      const timeStr = formatFullDateTime(evt.timestamp);
      return `
        <div class="activity-feed-item" data-email-id="${evt.emailId}">
          <div class="feed-icon-wrap ${isClick ? 'click' : 'open'}">
            ${isClick 
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>` 
              : `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9.75 4.33333C9.75 3.47128 9.40759 2.64448 8.79809 2.03498C8.18859 1.42548 7.36179 1.08333 6.5 1.08333C5.63821 1.08333 4.81141 1.42548 4.20191 2.03498C3.59241 2.64448 3.25 3.47128 3.25 4.33333C3.25 8.125 1.625 9.20833 1.625 9.20833H11.375C11.375 9.20833 9.75 8.125 9.75 4.33333Z" stroke="#059669" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.438 11.375C7.342 11.539 7.205 11.675 7.041 11.77C6.876 11.865 6.69 11.914 6.5 11.914C6.31 11.914 6.124 11.865 5.959 11.77C5.795 11.675 5.658 11.539 5.562 11.375" stroke="#059669" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
          </div>
          <div class="feed-content">
            <div class="feed-header-line">
              <div class="feed-recipient-row">
                <span class="feed-recipient">${escapeHtml(evt.recipient)}</span>
                <span class="feed-action-text">${isClick ? 'Clicked a link' : 'Opened your email'}</span>
              </div>
            </div>
            <div class="feed-time">${timeStr}</div>
            <div class="feed-subject">
              <span class="subject-prefix">Subject: </span>
              <span class="subject-val">${escapeHtml(evt.subject || '(No Subject)')}</span>
            </div>
            ${isClick && evt.url ? `<div class="feed-link-target">🔗 ${escapeHtml(evt.url)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    activityFeedList.querySelectorAll('.activity-feed-item').forEach(item => {
      item.onclick = () => openEmailDetails(item.dataset.emailId);
    });
  }

  // -------------------------------------------------------------
  // EMAIL DETAILS VIEW (Exact Figma Node 82:4805)
  // -------------------------------------------------------------
  const AVATAR_PALETTE = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4', '#6366F1'];
  function getAvatarColor(str) {
    if (!str) return AVATAR_PALETTE[0];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
  }

  function formatDetailedDate(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '—';
      const opts = getTimeFormatOptions();
      const day = d.toLocaleDateString([], { day: 'numeric', timeZone: opts.timeZone });
      const month = d.toLocaleDateString([], { month: 'short', timeZone: opts.timeZone });
      const year = d.toLocaleDateString([], { year: 'numeric', timeZone: opts.timeZone });
      const timeStr = d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        ...opts
      }).toLowerCase();
      return `${day} ${month} ${year}, ${timeStr}`;
    } catch {
      return formatDate(isoStr);
    }
  }

  function closeEmailDetails() {
    currentActiveDetailId = null;
    if (emailTrackingDetailsView) emailTrackingDetailsView.style.display = 'none';
    if (emailTableView) emailTableView.style.display = 'block';
    if (headerTitleGroup) headerTitleGroup.style.display = 'flex';
    if (headerRightActions) headerRightActions.style.display = 'flex';
    if (backToTrackingListBtn) backToTrackingListBtn.style.display = 'none';
  }

  if (backToTrackingListBtn) {
    backToTrackingListBtn.addEventListener('click', closeEmailDetails);
  }
  if (mobileDetailsBackBtn) {
    mobileDetailsBackBtn.addEventListener('click', closeEmailDetails);
  }

  function renderTimeline(email, selectedRecipient = 'all') {
    if (!detTimelineList) return;

    const recList = Array.isArray(email.recipients) && email.recipients.length > 0 
      ? email.recipients 
      : parseRecipientList(email.recipient);
    if (recList.length === 0) recList.push('Recipient');

    const events = [];

    // 1. Sent Events: Single combined entry for "Email delivered", showing all recipients together in one box
    const sentTitle = recList.length > 1
      ? `Sent to ${recList.map(escapeHtml).join(', ')}`
      : `Sent to ${escapeHtml(recList[0])}`;

    events.push({
      type: 'sent',
      timestamp: new Date(email.createdAt).getTime(),
      formattedTime: formatDetailedDate(email.createdAt),
      dotClass: 'grey',
      avatarBg: getAvatarColor(recList[0]),
      initial: recList[0].charAt(0).toUpperCase(),
      title: sentTitle,
      sub: 'Email delivered',
      recipient: 'all',
      recipients: recList.map(r => r.toLowerCase())
    });

    // 2. Open Events: separate entry per recipient with time
    if (Array.isArray(email.opens)) {
      email.opens.forEach((open, idx) => {
        let openRecs = parseRecipientList(open.recipient);
        if (openRecs.length === 0) {
          if (recList.length === 1) {
            openRecs = [recList[0]];
          } else {
            openRecs = [recList[idx % recList.length] || recList[0]];
          }
        }

        const displayLabel = formatDeviceDisplay(open.client);

        openRecs.forEach(rec => {
          events.push({
            type: 'open',
            timestamp: new Date(open.timestamp).getTime(),
            formattedTime: formatDetailedDate(open.timestamp),
            dotClass: 'green',
            avatarBg: getAvatarColor(rec),
            initial: rec.charAt(0).toUpperCase(),
            title: `${escapeHtml(rec)} Opened this mail`,
            sub: escapeHtml(displayLabel),
            recipient: rec.toLowerCase()
          });
        });
      });
    }

    // 3. Click Events: separate entry per recipient with time
    if (Array.isArray(email.clicks)) {
      email.clicks.forEach((click, idx) => {
        let clickRecs = parseRecipientList(click.recipient);
        if (clickRecs.length === 0) {
          if (recList.length === 1) {
            clickRecs = [recList[0]];
          } else {
            clickRecs = [recList[idx % recList.length] || recList[0]];
          }
        }

        clickRecs.forEach(rec => {
          events.push({
            type: 'click',
            timestamp: new Date(click.timestamp).getTime(),
            formattedTime: formatDetailedDate(click.timestamp),
            dotClass: 'blue',
            avatarBg: getAvatarColor(rec),
            initial: rec.charAt(0).toUpperCase(),
            title: `${escapeHtml(rec)} clicked link`,
            sub: `${escapeHtml(click.url)}`,
            recipient: rec.toLowerCase()
          });
        });
      });
    }

    // Filter by recipient if selected
    const filteredEvents = selectedRecipient === 'all'
      ? events
      : events.filter(e => {
          if (e.type === 'sent') {
            return !e.recipients || e.recipients.includes(selectedRecipient.toLowerCase());
          }
          return e.recipient === selectedRecipient.toLowerCase();
        }).map(e => {
          if (e.type === 'sent' && selectedRecipient !== 'all') {
            return {
              ...e,
              title: `Sent to ${escapeHtml(selectedRecipient)}`,
              avatarBg: getAvatarColor(selectedRecipient),
              initial: selectedRecipient.charAt(0).toUpperCase()
            };
          }
          return e;
        });

    // Sort descending by timestamp (newest first, sent at bottom)
    filteredEvents.sort((a, b) => b.timestamp - a.timestamp);

    if (filteredEvents.length === 0) {
      detTimelineList.innerHTML = `
        <div style="text-align: center; color: var(--text-subtitle); padding: 24px 0; font-size: 13px;">
          No timeline activity recorded for this recipient yet.
        </div>
      `;
      return;
    }

    detTimelineList.innerHTML = filteredEvents.map(evt => `
      <div class="timeline-row">
        <div class="timeline-col-time">${evt.formattedTime}</div>
        <div class="timeline-col-dot">
          <span class="timeline-dot ${evt.dotClass}"></span>
        </div>
        <div class="timeline-col-content">
          <div class="det-avatar-circle" style="background-color: ${evt.avatarBg};">${escapeHtml(evt.initial)}</div>
          <div class="timeline-content-details">
            <span class="timeline-event-title">${evt.title}</span>
            <span class="timeline-event-sub">${evt.sub}</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  function renderEmailDetailsView(email) {
    if (!emailTrackingDetailsView) return;

    const openCount = email.opens ? email.opens.length : (email.openCount || 0);
    const clickCount = email.clicks ? email.clicks.length : (email.clickCount || 0);

    // Hero Subject & Opens Pill
    if (detEmailSubject) detEmailSubject.textContent = email.subject || '(No Subject)';
    if (detEmailOpensPill) {
      detEmailOpensPill.textContent = `${openCount} open${openCount !== 1 ? 's' : ''}`;
    }

    // Metrics Bar
    if (detSentTime) detSentTime.textContent = formatDetailedDate(email.createdAt);
    if (detSender) detSender.textContent = email.sender || (currentUser && currentUser.email) || 'Me';
    if (detTotalOpen) detTotalOpen.textContent = openCount;
    if (detTotalClick) detTotalClick.textContent = clickCount;

    // Recipient Activity
    const recList = Array.isArray(email.recipients) && email.recipients.length > 0 
      ? email.recipients 
      : parseRecipientList(email.recipient);
    if (recList.length === 0) recList.push('Recipient');

    const openedRecipientsCount = recList.filter(rec => {
      const target = rec.toLowerCase();
      return (email.opens || []).some(o => {
        if (!o.recipient) return recList.length === 1;
        return parseRecipientList(o.recipient).some(r => r.toLowerCase() === target);
      });
    }).length;

    if (detRecipientSummary) {
      detRecipientSummary.textContent = `${openedRecipientsCount} of ${recList.length} recipient${recList.length !== 1 ? 's' : ''} opened this email.`;
    }

    if (detRecipientsTableBody) {
      detRecipientsTableBody.innerHTML = recList.map(rec => {
        const target = rec.toLowerCase();
        const recOpens = (email.opens || []).filter(o => {
          if (!o.recipient) return recList.length === 1;
          return parseRecipientList(o.recipient).some(r => r.toLowerCase() === target);
        });
        const recClicks = (email.clicks || []).filter(c => {
          if (!c.recipient) return recList.length === 1;
          return parseRecipientList(c.recipient).some(r => r.toLowerCase() === target);
        });
        const hasOpened = recOpens.length > 0;

        let latestActivityTime = null;
        if (recOpens.length > 0) {
          latestActivityTime = recOpens[recOpens.length - 1].timestamp;
        }
        if (recClicks.length > 0) {
          const lastClickTime = recClicks[recClicks.length - 1].timestamp;
          if (!latestActivityTime || new Date(lastClickTime) > new Date(latestActivityTime)) {
            latestActivityTime = lastClickTime;
          }
        }

        const lastActivityStr = latestActivityTime ? formatDetailedDate(latestActivityTime) : '-';

        return `
          <tr>
            <td>
              <div class="det-recipient-cell">
                <span class="det-avatar-circle" style="background-color: ${getAvatarColor(rec)};">
                  ${escapeHtml(rec.charAt(0).toUpperCase())}
                </span>
                <span class="det-recipient-email" title="${escapeHtml(rec)}">${escapeHtml(rec)}</span>
              </div>
            </td>
            <td>
              ${hasOpened
                ? `<span class="det-status-cell opened"><span class="det-status-dot green"></span>Opened</span>`
                : `<span class="det-status-cell unopened"><span class="det-status-dot grey"></span>Not Opened</span>`
              }
            </td>
            <td><span class="det-cell-number">${recOpens.length}</span></td>
            <td><span class="det-cell-number">${recClicks.length}</span></td>
            <td><span class="det-cell-muted">${lastActivityStr}</span></td>
          </tr>
        `;
      }).join('');
    }

    // Open Activity Timeline with Recipient Filter
    if (timelineRecipientFilter) {
      timelineRecipientFilter.innerHTML = `
        <option value="all">All Recipients</option>
        ${recList.map(rec => `<option value="${escapeHtml(rec)}">${escapeHtml(rec)}</option>`).join('')}
      `;
      timelineRecipientFilter.value = 'all';

      timelineRecipientFilter.onchange = (e) => {
        renderTimeline(email, e.target.value);
      };
    }

    renderTimeline(email, 'all');

    // Link Click Activity: Never group multiple recipients in a single row; separate rows per recipient with time
    if (detClicksTableBody) {
      const clickRows = [];
      if (email.clicks && email.clicks.length > 0) {
        email.clicks.forEach((click, idx) => {
          let clickRecs = parseRecipientList(click.recipient);
          if (clickRecs.length === 0) {
            if (recList.length === 1) {
              clickRecs = [recList[0]];
            } else {
              clickRecs = [recList[idx % recList.length] || recList[0]];
            }
          }

          clickRecs.forEach(rec => {
            clickRows.push({
              recipient: rec,
              url: click.url,
              timestamp: click.timestamp
            });
          });
        });
      }

      if (clickRows.length > 0) {
        clickRows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        detClicksTableBody.innerHTML = clickRows.map(row => `
          <tr>
            <td>
              <div class="det-recipient-cell">
                <span class="det-avatar-circle" style="background-color: ${getAvatarColor(row.recipient)};">
                  ${escapeHtml(row.recipient.charAt(0).toUpperCase())}
                </span>
                <span class="det-recipient-email" title="${escapeHtml(row.recipient)}">${escapeHtml(row.recipient)}</span>
              </div>
            </td>
            <td>
              <a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer" class="det-click-link" title="${escapeHtml(row.url)}">
                ${escapeHtml(row.url)}
              </a>
            </td>
            <td><span class="det-cell-muted">${formatDetailedDate(row.timestamp)}</span></td>
          </tr>
        `).join('');
      } else {
        detClicksTableBody.innerHTML = `
          <tr>
            <td colspan="3" class="det-empty-row">No link clicks recorded yet for this email</td>
          </tr>
        `;
      }
    }
  }

  function openEmailDetails(id) {
    const email = emails.find(e => e.id === id);
    if (!email) return;

    // User saw the email -> clear new open indicator & red dot
    if (email.isNewOpen || unseenOpenEmailIds.has(id)) {
      email.isNewOpen = false;
      unseenOpenEmailIds.delete(id);
      updateEmailTrackingBadge();
      renderDashboard();
    }

    currentActiveDetailId = id;

    // Ensure we are in Email Tracking tab
    if (activeTab !== 'email-tracking') {
      switchTab('email-tracking');
    }

    // Toggle views matching Figma (Desktop vs Mobile Node 225:13693)
    if (emailTableView) emailTableView.style.display = 'none';
    if (window.innerWidth > 768) {
      if (headerTitleGroup) headerTitleGroup.style.display = 'none';
      if (headerRightActions) headerRightActions.style.display = 'none';
      if (backToTrackingListBtn) backToTrackingListBtn.style.display = 'inline-flex';
    } else {
      if (headerRightActions) headerRightActions.style.display = 'flex';
      if (backToTrackingListBtn) backToTrackingListBtn.style.display = 'none';
    }
    if (emailTrackingDetailsView) emailTrackingDetailsView.style.display = 'flex';

    renderEmailDetailsView(email);
  }

  // Fallback modal handlers
  if (closeDetailsModalBtn && detailsModal) {
    closeDetailsModalBtn.onclick = () => {
      detailsModal.classList.remove('open');
    };
  }

  if (detailsModal) {
    detailsModal.onclick = (e) => {
      if (e.target === detailsModal) {
        detailsModal.classList.remove('open');
        currentActiveDetailId = null;
      }
    };
  }

  // -------------------------------------------------------------
  // TIME & DATE FORMATTING HELPERS
  // -------------------------------------------------------------
  function getTimeFormatOptions() {
    const is24h = currentUser && currentUser.settings && currentUser.settings.timeFormat === '24h';
    return {
      hour12: !is24h,
      timeZone: (currentUser && currentUser.settings && currentUser.settings.timezone !== 'auto') ? currentUser.settings.timezone : undefined
    };
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '—';
      const opts = getTimeFormatOptions();
      const day = d.toLocaleDateString([], { day: 'numeric', timeZone: opts.timeZone });
      const month = d.toLocaleDateString([], { month: 'short', timeZone: opts.timeZone });
      const timeStr = d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        ...opts
      }).toLowerCase();
      return `${day} ${month}, ${timeStr}`;
    } catch {
      return new Date(isoStr).toLocaleDateString();
    }
  }

  function formatTime(isoStr) {
    if (!isoStr) return '—';
    try {
      const opts = getTimeFormatOptions();
      return new Date(isoStr).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        ...opts
      });
    } catch {
      return new Date(isoStr).toLocaleTimeString();
    }
  }

  function formatFullDateTime(isoStr) {
    if (!isoStr) return '—';
    try {
      const opts = getTimeFormatOptions();
      return new Date(isoStr).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...opts
      });
    } catch {
      return new Date(isoStr).toLocaleString();
    }
  }

  function formatDeviceDisplay(client) {
    if (!client) return 'Read via Gmail (Google Proxy)';
    const c = String(client).trim();
    if (/Google Proxy|Gmail|Desktop/i.test(c)) return 'Read via Gmail (Google Proxy)';
    if (/iPhone/i.test(c)) return 'Read on iPhone';
    if (/iPad/i.test(c)) return 'Read on iPad';
    if (/Android/i.test(c)) return 'Read on Android';
    if (/Mac/i.test(c)) return 'Read on Mac';
    if (/Windows/i.test(c)) return 'Read on Windows PC';
    if (/Linux/i.test(c)) return 'Read on Linux PC';
    return `Read via ${c}`;
  }

  function formatDeviceName(client) {
    if (!client) return 'Gmail (Google Proxy)';
    const c = String(client).trim();
    if (/Google Proxy|Gmail|Desktop/i.test(c)) return 'Gmail (Google Proxy)';
    if (/iPhone/i.test(c)) return 'iPhone';
    if (/iPad/i.test(c)) return 'iPad';
    if (/Android/i.test(c)) return 'Android';
    if (/Mac/i.test(c)) return 'Mac';
    if (/Windows/i.test(c)) return 'Windows PC';
    if (/Linux/i.test(c)) return 'Linux PC';
    return c;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // -------------------------------------------------------------
  // PWA & MOBILE ADD TO HOME SCREEN PROMPT
  // -------------------------------------------------------------
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('[PWA] Service worker registration error:', err);
      });
    });
  }

  let deferredInstallPrompt = null;
  const mobileInstallBanner = document.getElementById('mobileInstallBanner');
  const installAppBtn = document.getElementById('installAppBtn');
  const closeInstallBannerBtn = document.getElementById('closeInstallBannerBtn');
  const mobileDropdownInstallApp = document.getElementById('mobileDropdownInstallApp');
  const iosInstallModal = document.getElementById('iosInstallModal');
  const closeIosInstallModal = document.getElementById('closeIosInstallModal');
  const iosInstallGotItBtn = document.getElementById('iosInstallGotItBtn');

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  function shouldShowInstallBanner() {
    if (isStandalone) return false;
    if (window.innerWidth > 768) return false;
    const dismissedAt = localStorage.getItem('mt_dismiss_install_banner');
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < 7 * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  }

  function showInstallBanner() {
    if (mobileInstallBanner && shouldShowInstallBanner()) {
      mobileInstallBanner.style.display = 'flex';
    }
  }

  function hideInstallBanner() {
    if (mobileInstallBanner) {
      mobileInstallBanner.style.display = 'none';
    }
  }

  // Handle Chrome / Android native install prompt capture
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner();
  });

  // For iOS or browsers without beforeinstallprompt, display prompt on mobile view after brief delay
  if (shouldShowInstallBanner()) {
    setTimeout(showInstallBanner, 1500);
  }

  function triggerInstallFlow() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          hideInstallBanner();
        }
        deferredInstallPrompt = null;
      });
    } else if (isIOS) {
      if (iosInstallModal) iosInstallModal.style.display = 'flex';
    } else {
      if (iosInstallModal) {
        iosInstallModal.style.display = 'flex';
      }
    }
  }

  if (installAppBtn) {
    installAppBtn.addEventListener('click', triggerInstallFlow);
  }

  if (mobileDropdownInstallApp) {
    mobileDropdownInstallApp.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileProfileDropdown();
      triggerInstallFlow();
    });
  }

  if (closeInstallBannerBtn) {
    closeInstallBannerBtn.addEventListener('click', () => {
      hideInstallBanner();
      localStorage.setItem('mt_dismiss_install_banner', Date.now().toString());
    });
  }

  if (closeIosInstallModal) {
    closeIosInstallModal.addEventListener('click', () => {
      if (iosInstallModal) iosInstallModal.style.display = 'none';
    });
  }

  if (iosInstallGotItBtn) {
    iosInstallGotItBtn.addEventListener('click', () => {
      if (iosInstallModal) iosInstallModal.style.display = 'none';
    });
  }

  if (iosInstallModal) {
    iosInstallModal.addEventListener('click', (e) => {
      if (e.target === iosInstallModal) {
        iosInstallModal.style.display = 'none';
      }
    });
  }

  // -------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mobile_sync') === 'success') {
    showToastNotification({
      title: '✓✓ Mobile Double Checkmarks Enabled!',
      subtitle: 'Your Gmail account is linked. Checkmarks (✓ & ✓✓) will now appear directly in your mobile Gmail app!',
      timestamp: new Date().toISOString()
    });
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  checkAuth().then(ok => {
    if (ok) {
      loadEmails();
      connectWebSocket();
    }
  });
});
