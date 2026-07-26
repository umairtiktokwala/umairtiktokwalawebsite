// inbox.html me apne existing "reply bhejo" function ko is se replace karein.
//
// Ahem tabdeeli: Firestore me message TAB save hota hai JAB Meta confirm kar de.
// Warna dashboard me message dikhta rahega jo student tak pohancha hi nahi.

async function sendReply(chatId, studentNumber, messageText) {
  const sendBtn = document.getElementById("sendBtn"); // apni button ki id daalein
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch("/api/send-whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: studentNumber, text: messageText }),
    });

    const result = await res.json();

    if (!result.ok) {
      // Meta ki asli error screen par dikhayein - chupayein nahi
      showError(explainError(result));
      console.error("WhatsApp send failed:", result);
      return false;
    }

    // Sirf kamyabi ke baad Firestore me save karein
    await saveMessageToFirestore(chatId, {
      direction: "outbound",
      text: messageText,
      waMessageId: result.messageId,
      status: "sent",
      timestamp: Date.now(),
    });

    return true;
  } catch (e) {
    showError("Server tak request nahi pohanchi: " + e.message);
    return false;
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Meta ke error codes ko aasan Urdu me tarjuma karta hai
function explainError(result) {
  switch (result.code) {
    case 190:
      return "Access token expire ho gaya hai. Permanent System User token banayein.";
    case 131030:
      return "App abhi Development mode me hai. Ya app ko Live karein, ya is number ko test recipients me add karein.";
    case 131047:
      return "24 ghante ki window band ho chuki hai. Ab sirf approved template message ja sakta hai.";
    case 131026:
      return "Ye number WhatsApp par mojood nahi, ya number ka format ghalat hai.";
    case 100:
      return "Ghalat parameter - phone_number_id ya number format check karein.";
    case 10:
    case 200:
      return "Token me permission nahi hai. whatsapp_business_messaging permission add karein.";
    default:
      return result.error || "Message bhejne me masla aaya.";
  }
}

function showError(msg) {
  // Apne UI ke hisab se badal lein - alert sirf misaal ke taur par hai
  alert("Message nahi gaya:\n\n" + msg);
}
