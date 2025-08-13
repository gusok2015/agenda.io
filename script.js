document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const monthYearEl = document.getElementById('current-month-year');
    const scheduleViewEl = document.getElementById('schedule-view');
    const monthViewEl = document.getElementById('month-view');
    const monthGridDaysEl = document.getElementById('month-grid-days');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const exportBtn = document.getElementById('export-btn');
    const saveIndicatorEl = document.getElementById('save-indicator');
    const monthViewBtn = document.getElementById('month-view-btn');
    const dayViewBtn = document.getElementById('day-view-btn');

    // --- State ---
    let currentDate = new Date();
    let currentView = 'month';
    let saveTimeout;

    // --- Functions ---

    const showSaveIndicator = () => {
        clearTimeout(saveTimeout);
        saveIndicatorEl.classList.add('visible');
        saveTimeout = setTimeout(() => {
            saveIndicatorEl.classList.remove('visible');
        }, 1500);
    };

    const formatDate = (date, options) => date.toLocaleDateString('es-ES', options);

    const fetchTasksForMonth = async (year, month) => {
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0); // Last day of the month

        const querySnapshot = await db.collection('tasks')
                                      .where('date', '>=', startDate.toISOString().split('T')[0])
                                      .where('date', '<=', endDate.toISOString().split('T')[0])
                                      .get();
        const tasksByDay = {};
        querySnapshot.forEach(doc => {
            const date = doc.data().date;
            tasksByDay[date] = (tasksByDay[date] || 0) + 1;
        });
        return tasksByDay;
    };

    const renderMonthView = async () => {
        monthGridDaysEl.innerHTML = '';
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDayOfWeek = firstDayOfMonth.getDay();

        const tasksForMonth = await fetchTasksForMonth(year, month); // Fetch all tasks for the month

        for (let i = 0; i < startDayOfWeek; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.classList.add('day-cell', 'not-current-month');
            monthGridDaysEl.appendChild(emptyCell);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            cell.classList.add('day-cell');
            const dayDate = new Date(year, month, day);
            const dayNumber = document.createElement('span');
            dayNumber.className = 'day-number';
            dayNumber.textContent = day;
            cell.appendChild(dayNumber);

            if (dayDate.toDateString() === new Date().toDateString()) {
                cell.classList.add('today');
            }

            const dateString = dayDate.toISOString().split('T')[0];
            const taskCount = tasksForMonth[dateString] || 0; // Get count from the fetched map
            if (taskCount > 0) {
                const indicator = document.createElement('div');
                indicator.className = 'task-indicator';
                indicator.textContent = taskCount;
                cell.appendChild(indicator);
            }

            cell.addEventListener('click', () => {
                currentDate = dayDate;
                currentView = 'day';
                render();
            });
            monthGridDaysEl.appendChild(cell);
        }
    };

    const renderDayView = () => {
        scheduleViewEl.innerHTML = '';
        for (let hour = 8; hour <= 22; hour++) {
            const timeSlot = document.createElement('div');
            timeSlot.classList.add('time-slot');
            const hourCell = document.createElement('div');
            hourCell.classList.add('hour-cell');
            hourCell.textContent = `${hour.toString().padStart(2, '0')}:00`;
            const taskCell = document.createElement('div');
            taskCell.classList.add('task-cell');
            const taskInput = document.createElement('textarea');
            taskInput.classList.add('task-input');
            taskCell.appendChild(taskInput); // ADDED THIS LINE

            const dateString = currentDate.toISOString().split('T')[0];
            const docId = `${dateString}-${hour}`; // Unique ID for the task document

            // Real-time listener for updates
            db.collection('tasks').doc(docId).onSnapshot(doc => {
                if (doc.exists) {
                    const newDescription = doc.data().description || '';
                    if (taskInput.value !== newDescription) { // Avoid updating if current user typed it
                        taskInput.value = newDescription;
                    }
                } else {
                    taskInput.value = ''; // Task was deleted
                }
            }, error => {
                console.error("Error listening to document:", error);
            });

            // Write to Firestore on input
            taskInput.addEventListener('input', () => {
                const description = taskInput.value;
                if (description) {
                    db.collection('tasks').doc(docId).set({
                        date: dateString,
                        hour: hour,
                        description: description,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    }).then(() => {
                        showSaveIndicator();
                    }).catch(error => {
                        console.error("Error writing document:", error);
                    });
                } else {
                    // If description is empty, delete the document
                    db.collection('tasks').doc(docId).delete().then(() => {
                        showSaveIndicator();
                    }).catch(error => {
                        console.error("Error deleting document:", error);
                    });
                }
            });

            const now = new Date();
            if (currentDate.toDateString() === now.toDateString()) {
                if (hour < now.getHours()) timeSlot.classList.add('past');
                else if (hour === now.getHours()) timeSlot.classList.add('now');
            } else if (currentDate < now) {
                timeSlot.classList.add('past');
            }
            timeSlot.appendChild(hourCell);
            timeSlot.appendChild(taskCell);
            scheduleViewEl.appendChild(timeSlot);
        }
    };

    const render = async () => {
        if (currentView === 'month') {
            monthYearEl.textContent = formatDate(currentDate, { month: 'long', year: 'numeric' });
            monthViewEl.classList.remove('hidden');
            scheduleViewEl.classList.add('hidden');
            exportBtn.classList.add('hidden');
            monthViewBtn.classList.add('active');
            dayViewBtn.classList.remove('active');
            await renderMonthView();
        } else { // 'day' view
            monthYearEl.textContent = formatDate(currentDate, { weekday: 'long', day: 'numeric', month: 'long' });
            monthViewEl.classList.add('hidden');
            scheduleViewEl.classList.remove('hidden');
            exportBtn.classList.remove('hidden');
            monthViewBtn.classList.remove('active');
            dayViewBtn.classList.add('active');
            renderDayView();
        }
    };

    const toICSDate = (date, hour) => {
        const d = new Date(date);
        d.setHours(hour, 0, 0, 0);
        return d.toISOString().replace(/[-:.]/g, '').slice(0, -4) + 'Z';
    };

    const exportToIcs = async () => {
        let ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gemini//Agenda App//EN'];
        const dateString = currentDate.toISOString().split('T')[0];
        const querySnapshot = await db.collection('tasks')
                                      .where('date', '==', dateString)
                                      .orderBy('hour')
                                      .get();

        querySnapshot.forEach(doc => {
            const taskData = doc.data();
            const hour = taskData.hour;
            const task = taskData.description;
            const key = `agenda-${dateString}-${hour}`; // Reconstruct key for UID

            ics.push('BEGIN:VEVENT',
                     `UID:${key}@gemini.agenda`,
                     `DTSTAMP:${toICSDate(new Date(), new Date().getHours())}`,
                     `DTSTART:${toICSDate(currentDate, hour)}`,
                     `DTEND:${toICSDate(currentDate, hour + 1)}`,
                     `SUMMARY:${task}`,
                     'END:VEVENT');
        });

        ics.push('END:VCALENDAR');
        const blob = new Blob([ics.join('\r\n')], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agenda-${dateString}.ics`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // --- Event Listeners ---
    prevBtn.addEventListener('click', async () => {
        if (currentView === 'month') {
            currentDate.setMonth(currentDate.getMonth() - 1);
        }
        else {
            currentDate.setDate(currentDate.getDate() - 1);
        }
        await render();
    });

    nextBtn.addEventListener('click', async () => {
        if (currentView === 'month') {
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
        else {
            currentDate.setDate(currentDate.getDate() + 1);
        }
        await render();
    });

    monthViewBtn.addEventListener('click', async () => {
        if (currentView !== 'month') {
            currentView = 'month';
            await render();
        }
    });

    dayViewBtn.addEventListener('click', async () => {
        if (currentView !== 'day') {
            currentView = 'day';
            await render();
        }
    });

    exportBtn.addEventListener('click', async () => {
        await exportToIcs();
    });

    // --- Initial Render ---
    await render();
});