const Https = require('https');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const AU_COURSE_CALENDAR_URL = 'https://students.algomau.ca/academic/calendarView2';
const AU_CAMPUS_LOCATIONS = ['SSM', 'BRA', 'TIM', 'ONL'];

function get_calendar_html(campus, term) {
    let params = '?';
    if (term)
        params += `term=${term}&`;

    params += `campus=${campus}`;

    const req_opts = {
        headers: {
            'User-Agent': 'au-scraper (https://github.com/ToppleKek/au-scraper)'
        }
    };

    return new Promise((resolve, reject) => {
        let res_data = '';

        const request = Https.get(AU_COURSE_CALENDAR_URL + params, req_opts, (res) => {
            res.on('data', (chunk) => {
                res_data += chunk;
            });

            res.on('end', () => {
                resolve(res_data);
            });

            res.on('error', (err) => {
                reject(err);
            });
        });

        request.end();
    });
}

function parse_courses(class_list_element) {
    const courses = [];

    for (const e of class_list_element.children) {
        const course_header = e.querySelector('.panel-title').textContent.trim().split(' - ');
        const course_code_full = course_header[0];
        const course_body = e.querySelector('.panel-body');
        const course_time_location = course_body.querySelector('.pull-left').children[0].innerHTML.trim().split('<br>');
        const registration_header = e.querySelector('.pull-right').textContent.trim();
        const instructor_type_location = Array.from(course_body.querySelector('.pull-right').children).map((e) => e.textContent.trim());

        let runtime, day, time, location;

        if (course_time_location.length !== 1)
            course_time_location.pop(); // Remove empty element

        if (course_time_location.join('') !== 'Online') {
            for (const l of course_time_location) {
                const line = l.trim();
                if (line.match(/MON|TUE|WED|THU|FRI/g))
                    day = line;
                else if (!isNaN(line.charAt(0)))
                    time = line;
                else if (line.startsWith('Location:'))
                    location = line.slice(10);
                else
                    runtime = line;
            }
        }

        let coinstructor, course_type, delivery_method;

        if (instructor_type_location.length === 3) {
            coinstructor = instructor_type_location[1].slice(14);
            course_type = instructor_type_location[2].split(',')[0];
            delivery_method = instructor_type_location[2].split(',')[1].trim();
        } else if (instructor_type_location.length === 2) {
            coinstructor = null;
            course_type = instructor_type_location[1].split(',')[0];
            delivery_method = instructor_type_location[1].split(',')[1].trim();
        }

        const course = {
            course_code_full,
            course_code: course_code_full.slice(0, -2),
            course_code_modifier: course_code_full.slice(course_code_full.length - 2),
            course_name: course_header.slice(1).join('-').trim(),
            registration_available: registration_header === 'REGISTRATION AVAILABLE',
            limited_registration: registration_header === 'LIMITED REGISTRATION AVAILABLE',
            cancelled: registration_header === 'CANCELLED',
            registration_status: registration_header,
            online: delivery_method === 'Online',
            runtime,
            day,
            time,
            location,
            instructor: instructor_type_location[0].slice(12),
            coinstructor,
            course_type,
            delivery_method,
            description: course_body.children[course_body.children.length - 1].textContent,
        };

        courses.push(course);
    }

    return courses;
}

async function get_terms(campus) {
    const test = await get_calendar_html(campus);
    const dom = new JSDOM(test);
    const term_selector_elements = Array.from(dom.window.document.getElementsByName('term')[0].children);
    return term_selector_elements.map((e) => {return { code: e.value, name: e.textContent.trim() };});
}

async function get_courses(campus, term) {
    const dom = new JSDOM(await get_calendar_html(campus, term.code));
    const row_elements = dom.window.document.getElementsByClassName('row');
    return parse_courses(row_elements[3].children[0]);
}

async function main() {
    const course_data = {
        scrape_date: Date.now(),
        campuses: {}
    };

    const campuses = await Promise.all(AU_CAMPUS_LOCATIONS.map(async (campus) => {
        return {
            name: campus,
            terms: await get_terms(campus)
        };
    }));

    for (const campus of campuses) {
        const campus_data = {
            terms: []
        };

        campus_data.terms = await Promise.all(campus.terms.map(async (term) => {
            return {
                code: term.code,
                name: term.name,
                courses: await get_courses(campus.name, term)
            };
        }));

        course_data.campuses[campus.name] = campus_data;
    }

    fs.writeFile(process.argv.slice(2).join(''), JSON.stringify(course_data), (err) => {
        if (err)
            console.error(err);
    });
}

main();
