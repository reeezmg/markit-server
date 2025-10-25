const admin = require('./firebase');

async function sendNotification(tokens, title, body, targetPage) {
  if (!tokens || tokens.length === 0) {
    console.log('⚠️ No device tokens provided');
    return;
  }

  const message = {
    notification: {
      title,
      body,
    },
    data: {
      route: targetPage
    },
    android: {
      notification: { sound: 'alert.wav' },
    },
    apns: {
      payload: {
        aps: {
          sound: 'alert.caf',
        },
      },
    },
    tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`📲 Push sent: ${response.successCount}/${tokens.length}`);
    if (response.failureCount > 0) {
      console.log('⚠️ Failed tokens:', response.responses.filter(r => !r.success));
    }
  } catch (err) {
    console.error('❌ Error sending push:', err);
  }
}

module.exports = { sendNotification };
